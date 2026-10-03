import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { platformOperator, platformTotp } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform organizations browser flow", () => {
  let environment, admin, owner, organization, currentPage
  beforeAll(async () => {
    environment = await startBrowserApplication()
    admin = await platformOperator(environment, environment.platformOrigin)
    owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Browser organization", slug: `browser-${randomUUID()}` },
    })
  })
  afterAll(async () => {
    await environment?.close()
  })
  afterEach(async ({ task }) => {
    if (
      task.result?.state === "fail" &&
      currentPage &&
      !currentPage.isClosed()
    ) {
      console.error(
        "Organization page failure",
        currentPage.url(),
        await currentPage.locator("body").innerText()
      )
    }
    await currentPage?.context().close()
  })
  const createOrganization = () =>
    environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Browser boundary", slug: `browser-${randomUUID()}` },
    })
  async function pageFor(actor, locale = "en-US") {
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [actor.user.id, locale]
    )
    const context = await environment.browser.newContext()
    await context.addCookies(
      actor.cookie.split("; ").map((item) => {
        const offset = item.indexOf("=")
        return {
          name: item.slice(0, offset),
          value: item.slice(offset + 1),
          url: environment.platformOrigin,
        }
      })
    )
    currentPage = await context.newPage()
    return currentPage
  }
  it("confirms the target in the real page, suspends tenant access and restores it", async () => {
    const page = await pageFor(admin)
    await page.goto(`${environment.platformOrigin}/platform/organizations`)
    await expectUI(
      page.getByRole("heading", { name: "Organizations", exact: true })
    ).toBeVisible()
    await page
      .getByRole("link", { name: organization.name, exact: true })
      .click()
    await expectUI(
      page.getByRole("heading", { name: organization.name, exact: true })
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    await expectUI(dialog).toBeVisible()
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Browser confirmed organization suspension")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(organization.slug)
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    await expectUI(
      page.getByRole("status").filter({ hasText: "Organization suspended." })
    ).toBeVisible()
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
      { headers: { cookie: owner.cookie } }
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "ORGANIZATION_SUSPENDED",
    })
    await page
      .getByRole("button", { name: "Resume organization", exact: true })
      .click()
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Browser confirmed organization restoration")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(organization.slug)
    await dialog
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    expect(
      (
        await fetch(
          `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
          { headers: { cookie: owner.cookie } }
        )
      ).status
    ).toBe(200)
    await page.screenshot({
      path: join(tmpdir(), "enterprise-admin-issue20-en.png"),
      fullPage: true,
    })
    await page.context().close()
  })

  it("retries an uncertain committed result with the same body and key while preserving the draft", async () => {
    const target = await createOrganization()
    const page = await pageFor(admin)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    const reason = "Preserve draft and retry uncertain write result"
    await dialog.getByLabel("Reason", { exact: true }).fill(reason)
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    const requests = []
    await page.route(
      `**/api/v1/platform/organizations/${target.id}/suspend`,
      async (route) => {
        requests.push({
          key: route.request().headers()["idempotency-key"],
          body: route.request().postDataJSON(),
        })
        if (requests.length === 1) {
          const response = await route.fetch()
          expect(response.status()).toBe(200)
          await route.abort("failed")
        } else await route.continue()
      }
    )
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(dialog.getByRole("alert")).toContainText(
      "operation result is unconfirmed"
    )
    await expectUI(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
      reason
    )
    await expectUI(dialog.getByLabel("Reason", { exact: true })).toBeDisabled()
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    const response = await page
      .context()
      .request.get(
        `${environment.platformOrigin}/api/v1/platform/organizations/${target.id}`
      )
    const detail = await response.json()
    expect(detail.version).toBe(2)
    expect(detail.history).toHaveLength(1)
  })

  it("retains a stale draft until the administrator reviews the new version", async () => {
    const target = await createOrganization()
    const page = await pageFor(admin)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    const reason = "Stale confirmation keeps this reason draft"
    await dialog.getByLabel("Reason", { exact: true }).fill(reason)
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    const parallel = await page
      .context()
      .request.post(
        `${environment.platformOrigin}/api/v1/platform/organizations/${target.id}/suspend`,
        {
          headers: {
            origin: environment.platformOrigin,
            "Idempotency-Key": randomUUID(),
          },
          data: {
            reason: "Another administrator changed this organization",
            expectedVersion: 1,
          },
        }
      )
    expect(parallel.status()).toBe(200)
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(dialog.getByRole("alert")).toBeVisible()
    await expectUI(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
      reason
    )
    const review = dialog.getByRole("button", {
      name: "Review and confirm the latest state",
      exact: true,
    })
    await expectUI(review).toBeEnabled()
    await review.click()
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    await expectUI(
      page
        .getByRole("status")
        .filter({ hasText: "already in the target state" })
    ).toBeVisible()
  })

  it("performs recent session MFA in the confirmation dialog without clearing the operation draft", async () => {
    const target = await createOrganization()
    const page = await pageFor(admin)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Recent session MFA confirmation from the real page")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    await environment.migrator.query(
      "UPDATE public.platform_session_assurance SET verified_at = clock_timestamp() - interval '16 minutes' WHERE user_id = $1",
      [admin.user.id]
    )
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(
      dialog.getByLabel("Six-digit code", { exact: true })
    ).toBeVisible()
    await expectUI(dialog.getByLabel("Reason", { exact: true })).toHaveValue(
      "Recent session MFA confirmation from the real page"
    )
    await dialog
      .getByLabel("Six-digit code", { exact: true })
      .fill(platformTotp(admin.secret))
    await dialog
      .getByRole("button", { name: "Verify and retry", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    admin.cookie = (await page.context().cookies())
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ")
  })

  it("supports Arabic RTL validation, keyboard confirmation, focus return and accessible controls", async () => {
    const target = await createOrganization()
    const page = await pageFor(admin, "ar")
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    const trigger = page.getByRole("button", {
      name: "إيقاف المنظمة",
      exact: true,
    })
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("alertdialog")
    await expectUI(dialog).toBeVisible()
    await dialog
      .getByLabel("السبب", { exact: true })
      .fill("سبب مؤكد لإيقاف المنظمة في اختبار المتصفح")
    await dialog.getByLabel("معرّف المنظمة", { exact: true }).fill("wrong-slug")
    const confirm = dialog.getByRole("button", {
      name: "تأكيد الإيقاف",
      exact: true,
    })
    await confirm.click()
    await expectUI(
      dialog.getByText("أدخل معرّف المنظمة المستهدفة بالكامل.", { exact: true })
    ).toBeVisible()
    await dialog.getByLabel("معرّف المنظمة", { exact: true }).fill(target.slug)
    const a11yRequire = createRequire(resolve("apps/storybook/package.json"))
    await page.addScriptTag({
      path: a11yRequire.resolve("axe-core/axe.min.js"),
    })
    const violations = await page.evaluate(
      async () =>
        (
          await window.axe.run(document.querySelector('[role="alertdialog"]'), {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations
    )
    expect(violations).toEqual([])
    await page.screenshot({
      path: join(tmpdir(), "enterprise-admin-issue20-ar.png"),
      fullPage: true,
    })
    await confirm.focus()
    await page.keyboard.press("Enter")
    await expectUI(dialog).not.toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "استئناف المنظمة", exact: true })
    ).toBeFocused()
  })

  it("keeps auditors read-only in the page and rejects direct writes without disclosing member identities", async () => {
    const actor = await platformOperator(
      environment,
      environment.platformOrigin,
      "platform_auditor"
    )
    const page = await pageFor(actor)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${organization.id}`
    )
    await expectUI(
      page.getByRole("heading", { name: "Member overview", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "Suspend organization", exact: true })
    ).toHaveCount(0)
    await expectUI(
      page.getByRole("button", { name: "Resume organization", exact: true })
    ).toHaveCount(0)
    expect(await page.locator("main").innerText()).not.toContain(owner.email)
    const response = await page
      .context()
      .request.post(
        `${environment.platformOrigin}/api/v1/platform/organizations/${organization.id}/suspend`,
        {
          headers: {
            origin: environment.platformOrigin,
            "Idempotency-Key": randomUUID(),
          },
          data: { reason: "Auditor must remain read only", expectedVersion: 3 },
        }
      )
    expect(response.status()).toBe(403)
  })
  it("keeps a confirmed success visible when the following detail refresh fails", async () => {
    const target = await createOrganization()
    const page = await pageFor(admin)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Confirmed write precedes a failed detail refresh")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    await page.route(`**/api/v1/platform/organizations/${target.id}`, (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "AUDIT_UNAVAILABLE" }),
      })
    )
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    await expectUI(
      page.getByRole("status").filter({ hasText: "Organization suspended." })
    ).toBeVisible()
    await expectUI(page.getByRole("alert")).toBeVisible()
    expect(
      (
        await fetch(
          `${environment.baseURL}/api/v1/organizations/${target.id}/projects`,
          { headers: { cookie: owner.cookie } }
        )
      ).status
    ).toBe(403)
  })

  it("removes the protected page after platform assignment revocation and a rejected confirmation", async () => {
    const actor = await platformOperator(
      environment,
      environment.platformOrigin
    )
    const target = await createOrganization()
    const page = await pageFor(actor)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("A revoked operator must leave the protected page")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    await environment.deployerPool.query(
      "UPDATE public.platform_assignment SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by = current_user, revoke_reason = 'browser revocation' WHERE user_id = $1",
      [actor.user.id]
    )
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(page).toHaveURL(/\/platform\/access-denied$/)
    await expectUI(
      page.getByRole("heading", { name: "Platform access denied", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: target.name, exact: true })
    ).toHaveCount(0)
    const state = await environment.migrator.query(
      "SELECT status FROM public.organization_status WHERE organization_id = $1",
      [target.id]
    )
    expect(state.rows[0].status).toBe("ACTIVE")
    await environment.deployerPool.query(
      "UPDATE public.platform_assignment SET status = 'active', revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE user_id = $1",
      [actor.user.id]
    )
    const freshName = "Organization read after a new platform grant"
    await environment.migrator.query(
      "UPDATE public.organization SET name = $2 WHERE id = $1",
      [target.id, freshName]
    )
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route(
      `**/api/v1/platform/organizations/${target.id}`,
      async (route) => {
        await gate
        await route.continue()
      }
    )
    try {
      await page.goBack()
      await expectUI(
        page.locator('[role="status"][aria-busy="true"]')
      ).toBeVisible()
      await expectUI(
        page.getByRole("heading", { name: target.name, exact: true })
      ).toHaveCount(0)
    } finally {
      release()
    }
    await expectUI(
      page.getByRole("heading", { name: freshName, exact: true })
    ).toBeVisible()
  })

  it("returns to sign-in after the current session is revoked during confirmation", async () => {
    const actor = await platformOperator(
      environment,
      environment.platformOrigin
    )
    const target = await createOrganization()
    const page = await pageFor(actor)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("An expired session must restore authoritative identity")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    const sessions = await environment.migrator.query(
      "SELECT token FROM public.session WHERE user_id = $1",
      [actor.user.id]
    )
    const revoked = await fetch(
      `${environment.baseURL}/api/auth/revoke-session`,
      {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          origin: environment.platformOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: sessions.rows[0].token }),
      }
    )
    expect(revoked.status).toBe(200)
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(page).toHaveURL(/\/login$/)
    await expectUI(
      page.getByRole("button", { name: "Sign in", exact: true })
    ).toBeVisible()
  })
  it("clears the protected view and requests MFA when session assurance is lost rather than only aged", async () => {
    const actor = await platformOperator(
      environment,
      environment.platformOrigin
    )
    const target = await createOrganization()
    const page = await pageFor(actor)
    await page.goto(
      `${environment.platformOrigin}/platform/organizations/${target.id}`
    )
    await page
      .getByRole("button", { name: "Suspend organization", exact: true })
      .click()
    const dialog = page.getByRole("alertdialog")
    await dialog
      .getByLabel("Reason", { exact: true })
      .fill("Missing assurance revokes platform read eligibility")
    await dialog
      .getByLabel("Organization slug", { exact: true })
      .fill(target.slug)
    await environment.migrator.query(
      "DELETE FROM public.platform_session_assurance WHERE user_id = $1",
      [actor.user.id]
    )
    await dialog
      .getByRole("button", { name: "Confirm suspension", exact: true })
      .click()
    await expectUI(page).toHaveURL(/\/platform\/mfa/)
    await expectUI(dialog).not.toBeVisible()
    await expectUI(
      page.getByRole("heading", {
        name: "Verify your platform identity",
        exact: true,
      })
    ).toBeVisible()
  })
})
