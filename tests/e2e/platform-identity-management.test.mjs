import { randomBytes, randomUUID } from "node:crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { waitForMail } from "../setup/mailpit.mjs"

async function attach(context, cookie, origin) {
  await context.addCookies(
    cookie.split("; ").map((part) => {
      const separator = part.indexOf("=")
      return {
        name: part.slice(0, separator),
        value: part.slice(separator + 1),
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      }
    })
  )
}

const clientIp = () => `10.${[...randomBytes(3)].join(".")}`

describe("platform identity management browser flows", () => {
  let environment
  let admin
  let auditor
  let contexts = []
  let currentPage

  beforeAll(async () => {
    environment = await startBrowserApplication({ mail: true })
    admin = await platformOperator(environment, environment.platformOrigin)
    auditor = await platformOperator(
      environment,
      environment.platformOrigin,
      "platform_auditor"
    )
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [admin.user.id, "en-US"]
    )
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [auditor.user.id, "en-US"]
    )
  })

  afterEach(async ({ task }) => {
    if (task.result?.state === "fail" && currentPage && !currentPage.isClosed())
      console.error(
        currentPage.url(),
        await currentPage.locator("body").innerText()
      )
    await Promise.all(contexts.map((context) => context.close()))
    contexts = []
    currentPage = undefined
  })

  afterAll(async () => environment?.close())

  async function platformPage(path, actor = admin) {
    const context = await environment.browser.newContext()
    contexts.push(context)
    await attach(context, actor.cookie, environment.platformOrigin)
    currentPage = await context.newPage()
    await currentPage.goto(`${environment.platformOrigin}${path}`)
    return currentPage
  }

  it("creates a verified account, edits its name, suspends and resumes it, then requests a reset email", async () => {
    const page = await platformPage("/platform/users")
    const email = `managed-${randomUUID()}@example.test`
    const password = randomBytes(24).toString("hex")
    const originalName = `Managed ${randomUUID()}`
    const updatedName = `Renamed ${randomUUID()}`

    await page.getByRole("button", { name: "Create account" }).click()
    const createDialog = page.getByRole("dialog")
    await createDialog.getByLabel("Name", { exact: true }).fill(originalName)
    await createDialog.getByLabel("Email", { exact: true }).fill(email)
    await createDialog.getByLabel("Password", { exact: true }).fill(password)
    await createDialog
      .getByRole("button", { name: "Create account", exact: true })
      .click()

    await expectUI(page).toHaveURL(/\/platform\/users\/[0-9a-f-]+$/)
    await expectUI(
      page.getByRole("heading", { name: originalName, exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("Verified", { exact: true })).toBeVisible()
    const account = await environment.migrator.query(
      'SELECT id, email_verified FROM public."user" WHERE email = $1',
      [email]
    )
    expect(account.rows).toHaveLength(1)
    expect(account.rows[0].email_verified).toBe(true)
    const userId = account.rows[0].id
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [userId, "en-US"]
    )

    await page.getByRole("button", { name: "Edit account" }).click()
    const editDialog = page.getByRole("dialog")
    await editDialog.getByLabel("Name", { exact: true }).fill(updatedName)
    await editDialog.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(editDialog).not.toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: updatedName, exact: true })
    ).toBeVisible()
    expect(
      (
        await environment.migrator.query(
          'SELECT name FROM public."user" WHERE id = $1',
          [userId]
        )
      ).rows[0].name
    ).toBe(updatedName)

    await page.getByRole("button", { name: "Suspend account" }).click()
    const suspendDialog = page.getByRole("dialog")
    await suspendDialog
      .getByRole("button", { name: "Suspend account", exact: true })
      .click()
    await expectUI(suspendDialog).not.toBeVisible()
    await expectUI(page.getByText("Suspended", { exact: true })).toBeVisible()
    expect(
      (
        await environment.migrator.query(
          "SELECT status FROM public.user_account_status WHERE user_id = $1",
          [userId]
        )
      ).rows[0].status
    ).toBe("suspended")

    await page.getByRole("button", { name: "Resume account" }).click()
    const resumeDialog = page.getByRole("dialog")
    await resumeDialog
      .getByRole("button", { name: "Resume account", exact: true })
      .click()
    await expectUI(resumeDialog).not.toBeVisible()
    await expectUI(page.getByText("Active", { exact: true })).toBeVisible()
    expect(
      (
        await environment.migrator.query(
          "SELECT status FROM public.user_account_status WHERE user_id = $1",
          [userId]
        )
      ).rows[0].status
    ).toBe("active")

    await page
      .getByRole("button", { name: "Send password reset email" })
      .click()
    const resetDialog = page.getByRole("dialog")
    await resetDialog
      .getByRole("button", { name: "Send password reset email", exact: true })
      .click()
    await expectUI(
      page.getByText("Password reset email request submitted.", { exact: true })
    ).toBeVisible()
    await waitForMail(environment.mailpitOrigin, email, "Reset your password")
    await page.screenshot({
      path: "/private/tmp/identity-account-management.png",
      fullPage: true,
    })
  })

  it("filters and paginates global login records and restores the query after reload", async () => {
    for (let index = 0; index < 21; index += 1) {
      const response = await fetch(
        `${environment.baseURL}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            origin: environment.platformOrigin,
            "content-type": "application/json",
            "x-real-ip": clientIp(),
          },
          body: JSON.stringify({
            email: admin.email,
            password: `wrong-${randomUUID()}`,
          }),
        }
      )
      expect(response.status).toBe(401)
    }

    const page = await platformPage("/platform/login-events")
    await expectUI(
      page.getByRole("heading", { name: "Login history", exact: true })
    ).toBeVisible()
    const search = page.getByPlaceholder("Search account, email, or IP")
    await search.fill(admin.user.name)
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await page.getByRole("button", { name: "Result", exact: true }).click()
    await page.getByRole("option", { name: "Failed", exact: true }).click()
    await page.keyboard.press("Escape")
    await expectUI(page).toHaveURL(/result=failed/)
    await expectUI(page.locator("tbody tr")).toHaveCount(20)

    await page
      .getByRole("button", { name: "Advanced filters", exact: true })
      .click()
    const from = new Date().toISOString().slice(0, 10) + "T00:00"
    await page.getByLabel("From (UTC)", { exact: true }).fill(from)
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page).toHaveURL(/from=/)
    await expectUI(page.locator("tbody tr")).toHaveCount(20)

    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expectUI(page).toHaveURL(/page=2/)
    await expectUI(page.locator("tbody tr")).toHaveCount(1)
    await page.reload()
    await expectUI(page.locator("tbody tr")).toHaveCount(1)
    expect(new URL(page.url()).searchParams.get("q")).toBe(admin.user.name)
    expect(new URL(page.url()).searchParams.get("result")).toBe("failed")
    expect(new URL(page.url()).searchParams.get("page")).toBe("2")
    await page.screenshot({
      path: "/private/tmp/identity-platform-login-history.png",
      fullPage: true,
    })
  })

  it("lets auditors read the directory and sessions without account mutation controls", async () => {
    const page = await platformPage("/platform/users", auditor)
    await expectUI(
      page.getByRole("heading", { name: "Users", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "Create account", exact: true })
    ).toHaveCount(0)
    await page.goto(
      `${environment.platformOrigin}/platform/users/${admin.user.id}`
    )
    await expectUI(
      page.getByRole("heading", { name: admin.user.name, exact: true })
    ).toBeVisible()
    for (const name of [
      "Edit account",
      "Suspend account",
      "Send password reset email",
    ]) {
      await expectUI(
        page.getByRole("button", { name, exact: true })
      ).toHaveCount(0)
    }
    await page.goto(`${environment.platformOrigin}/platform/sessions`)
    await expectUI(
      page.getByRole("heading", { name: "Global sessions", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("tbody tr")).not.toHaveCount(0)
    await expectUI(
      page.getByRole("button", { name: "Revoke session", exact: true })
    ).toHaveCount(0)
  })

  it("revokes the selected global session and leaves the other session active", async () => {
    const target = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: `Session target ${randomUUID()}` }
    )
    await environment.migrator.query(
      "DELETE FROM public.session WHERE user_id = $1",
      [target.user.id]
    )
    const revokeContext = await environment.browser.newContext({
      userAgent: "Browser session selected for revocation",
      extraHTTPHeaders: { "x-real-ip": clientIp() },
    })
    const keepContext = await environment.browser.newContext({
      userAgent: "Browser session kept active",
      extraHTTPHeaders: { "x-real-ip": clientIp() },
    })
    contexts.push(revokeContext, keepContext)
    for (const [context, userAgent] of [
      [revokeContext, "Browser session selected for revocation"],
      [keepContext, "Browser session kept active"],
    ]) {
      const login = await context.request.post(
        `${environment.baseURL}/api/auth/sign-in/email`,
        {
          headers: {
            origin: environment.tenantOrigin,
            "user-agent": userAgent,
          },
          data: { email: target.email, password: target.password },
        }
      )
      expect(login.status()).toBe(200)
    }

    const page = await platformPage(
      `/platform/sessions?userId=${target.user.id}`
    )
    await expectUI(page.locator("tbody tr")).toHaveCount(2)
    const selected = page
      .locator("tbody tr")
      .filter({ hasText: "Browser session selected for revocation" })
    await selected
      .getByRole("button", { name: "Revoke session", exact: true })
      .click()
    const confirm = page.getByRole("dialog")
    await confirm.getByRole("button", { name: "Confirm", exact: true }).click()
    await expectUI(
      page.getByText("Session revoked.", { exact: true })
    ).toBeVisible()
    await expectUI(page.locator("tbody tr")).toHaveCount(1)
    await expectUI(
      page.getByText("Browser session kept active", { exact: true })
    ).toBeVisible()

    expect(
      (
        await revokeContext.request.get(
          `${environment.baseURL}/api/v1/me/preferences`
        )
      ).status()
    ).toBe(401)
    expect(
      (
        await keepContext.request.get(
          `${environment.baseURL}/api/v1/me/preferences`
        )
      ).status()
    ).toBe(200)
    await page.screenshot({
      path: "/private/tmp/identity-platform-sessions.png",
      fullPage: true,
    })
  })

  it("shows only the signed-in tenant account's personal login events", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: `Tenant log owner ${randomUUID()}` }
    )
    const other = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: `Tenant other ${randomUUID()}` }
    )
    const ownerAgent = `Tenant owner browser ${randomUUID()}`
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [owner.user.id, "en-US"]
    )
    const otherAgent = `Different tenant browser ${randomUUID()}`
    for (const [account, userAgent] of [
      [owner, ownerAgent],
      [other, otherAgent],
    ]) {
      const response = await fetch(
        `${environment.baseURL}/api/auth/sign-in/email`,
        {
          method: "POST",
          headers: {
            origin: environment.tenantOrigin,
            "content-type": "application/json",
            "user-agent": userAgent,
            "x-real-ip": clientIp(),
          },
          body: JSON.stringify({
            email: account.email,
            password: account.password,
          }),
        }
      )
      expect(response.status).toBe(200)
    }

    const context = await environment.browser.newContext()
    contexts.push(context)
    await attach(context, owner.cookie, environment.tenantOrigin)
    const page = await context.newPage()
    currentPage = page
    await page.goto(`${environment.tenantOrigin}/app/settings/preferences`)
    const [response] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/v1/me/login-events"
      ),
      page.getByRole("link", { name: "Login history", exact: true }).click(),
    ])
    await expectUI(page).toHaveURL(/\/app\/settings\/login-events/)
    await expectUI(
      page.getByRole("heading", { name: "My login history", exact: true })
    ).toBeVisible()
    const payload = await response.json()
    expect(payload.items.length).toBeGreaterThan(0)
    expect(payload.items.every((item) => item.userId === owner.user.id)).toBe(
      true
    )
    expect(payload.items.map((item) => item.userAgent)).toContain(ownerAgent)
    expect(payload.items.map((item) => item.userAgent)).not.toContain(
      otherAgent
    )
    await expectUI(page.locator("main")).toContainText(ownerAgent)
    await expectUI(page.locator("main")).not.toContainText(otherAgent)
    await page.screenshot({
      path: "/private/tmp/identity-personal-login-history.png",
      fullPage: true,
    })
  })
})
