import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform user directory browser flow", () => {
  let environment, admin, auditor, target, currentPage
  beforeAll(async () => {
    environment = await startBrowserApplication()
    admin = await platformOperator(environment, environment.platformOrigin)
    auditor = await platformOperator(
      environment,
      environment.platformOrigin,
      "platform_auditor"
    )
    target = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      {
        name: "Browser directory target",
        email: "browser-private@example.test",
      }
    )
    await environment.runtime.auth.api.createOrganization({
      headers: target.headers,
      body: {
        name: "Browser directory association",
        slug: `directory-${randomUUID()}`,
      },
    })
    await environment.migrator
      .query(`INSERT INTO public."user"(id, name, email, email_verified, created_at, updated_at)
      SELECT gen_random_uuid(), 'Browser directory ' || n, 'directory-' || n || '@example.test', false, timestamp '2025-01-01', timestamp '2025-01-01' FROM generate_series(1, 22) AS n`)
  })
  afterAll(async () => {
    await environment?.close()
  })
  afterEach(async ({ task }) => {
    if (task.result?.state === "fail" && currentPage && !currentPage.isClosed())
      console.error(
        currentPage.url(),
        await currentPage.locator("body").innerText()
      )
    await currentPage?.context().close()
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

  it("searches and paginates the real masked directory and navigates to account summary", async () => {
    const page = await pageFor(admin)
    await page.goto(
      `${environment.platformOrigin}/platform/users?q=Browser%20directory`
    )
    await expectUI(
      page.getByRole("heading", { name: "Users", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await page.getByLabel("Next page", { exact: true }).click()
    await expectUI(page).toHaveURL(/page=2/)
    await expectUI(page.locator("tbody tr")).toHaveCount(3)
    await page
      .getByLabel("Search name, user ID or masked email")
      .fill("Browser directory target")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.locator("tbody tr")).toHaveCount(1)
    expect(await page.locator("main").innerText()).not.toContain(target.email)
    await page
      .getByRole("link", { name: target.user.name, exact: true })
      .click()
    await expectUI(
      page.getByRole("heading", {
        name: "Organization memberships",
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByText("Browser directory association", { exact: true })
    ).toBeVisible()
    expect(await page.locator("main").innerText()).not.toContain(target.email)
    await page.screenshot({
      path: "/private/tmp/enterprise-admin-issue21-en.png",
      fullPage: true,
    })
  })

  it("keeps sensitive reads explicit, preserves purpose after a server failure, and clears email when the dialog closes", async () => {
    const page = await pageFor(admin)
    const sensitiveRequests = []
    page.on("request", (request) => {
      if (request.url().includes("/sensitive-profile"))
        sensitiveRequests.push(request.url())
    })
    await page.goto(
      `${environment.platformOrigin}/platform/users/${target.user.id}`
    )
    const trigger = page.getByRole("button", {
      name: "View full email",
      exact: true,
    })
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog")
    await expectUI(dialog).toBeVisible()
    expect(sensitiveRequests).toEqual([])
    const purpose = "Browser support investigation purpose"
    await dialog.getByLabel("Purpose of access", { exact: true }).fill(purpose)
    await environment.migrator
      .query(`CREATE FUNCTION public.issue21_browser_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_code = 'platform.user_sensitive_read' THEN RAISE EXCEPTION 'browser audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER issue21_browser_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue21_browser_audit_failure();`)
    try {
      await dialog
        .getByRole("button", { name: "View full email", exact: true })
        .click()
      await expectUI(dialog.getByRole("alert")).toBeVisible()
      await expectUI(
        dialog.getByLabel("Purpose of access", { exact: true })
      ).toHaveValue(purpose)
      expect(await dialog.innerText()).not.toContain(target.email)
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER issue21_browser_audit_failure ON public.audit_events; DROP FUNCTION public.issue21_browser_audit_failure()"
      )
    }
    await dialog
      .getByRole("button", { name: "View full email", exact: true })
      .focus()
    await page.keyboard.press("Enter")
    await expectUI(dialog.getByRole("status")).toHaveText(target.email)
    expect(sensitiveRequests).toHaveLength(2)
    expect(new URL(sensitiveRequests[1]).searchParams.get("purpose")).toBe(
      purpose
    )
    await page.keyboard.press("Escape")
    await expectUI(dialog).not.toBeVisible()
    await expectUI(trigger).toBeFocused()
    expect(await page.locator("body").innerText()).not.toContain(target.email)
    await trigger.click()
    await expectUI(
      dialog.getByLabel("Purpose of access", { exact: true })
    ).toHaveValue("")
    expect(await dialog.innerText()).not.toContain(target.email)
  })

  it("keeps auditors masked in network and DOM, including related organization reads", async () => {
    const page = await pageFor(auditor)
    const projections = []
    page.on("response", (response) => {
      if (response.url().includes("/api/v1/platform/users"))
        projections.push(response)
    })
    await page.goto(
      `${environment.platformOrigin}/platform/users?q=Browser%20directory%20target`
    )
    await page
      .getByRole("link", { name: target.user.name, exact: true })
      .click()
    await expectUI(
      page.getByRole("heading", {
        name: "Organization memberships",
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "View full email", exact: true })
    ).toHaveCount(0)
    expect(await page.locator("main").innerText()).not.toContain(target.email)
    for (const response of projections)
      expect(await response.text()).not.toContain(target.email)
    const denied = await page
      .context()
      .request.get(
        `${environment.platformOrigin}/api/v1/platform/users/${target.user.id}/sensitive-profile?purpose=investigation`
      )
    expect(denied.status()).toBe(403)
    expect(await denied.text()).not.toContain(target.email)
  })

  for (const [locale, viewLabel, purposeLabel, summaryLabel] of [
    ["zh-CN", "查看完整邮箱", "读取目的", "组织关联"],
    ["ar", "عرض البريد الإلكتروني الكامل", "غرض الوصول", "عضويات المنظمات"],
  ]) {
    it(`provides ${locale} labels, keyboard interaction and accessible sensitive controls`, async () => {
      const page = await pageFor(admin, locale)
      await page.goto(
        `${environment.platformOrigin}/platform/users/${target.user.id}`
      )
      await expectUI(
        page.getByRole("heading", { name: summaryLabel, exact: true })
      ).toBeVisible()
      await expectUI(page.locator("html")).toHaveAttribute("lang", locale)
      await expectUI(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr"
      )
      await page.getByRole("button", { name: viewLabel, exact: true }).focus()
      await page.keyboard.press("Enter")
      const dialog = page.getByRole("dialog")
      await dialog.getByLabel(purposeLabel, { exact: true }).fill(" ")
      await dialog.getByRole("button", { name: viewLabel, exact: true }).click()
      await expectUI(dialog.locator('[data-invalid="true"]')).toHaveCount(1)
      await dialog
        .getByLabel(purposeLabel, { exact: true })
        .fill("طلب دعم للمستخدم المحدد")
      const a11yRequire = createRequire(resolve("apps/storybook/package.json"))
      await page.addScriptTag({
        path: a11yRequire.resolve("axe-core/axe.min.js"),
      })
      const violations = await page.evaluate(
        async () =>
          (
            await window.axe.run(document.querySelector('[role="dialog"]'), {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21aa"],
              },
            })
          ).violations
      )
      expect(violations).toEqual([])
      await dialog.getByRole("button", { name: viewLabel, exact: true }).focus()
      await page.keyboard.press("Enter")
      await expectUI(dialog.getByRole("status")).toHaveText(target.email)
      await page.screenshot({
        path: `/private/tmp/enterprise-admin-issue21-${locale}.png`,
        fullPage: true,
      })
    })
  }

  it("removes the full-email dialog after sensitive permission is revoked within the same session", async () => {
    const actor = await platformOperator(
      environment,
      environment.platformOrigin
    )
    const page = await pageFor(actor)
    await page.goto(
      `${environment.platformOrigin}/platform/users/${target.user.id}`
    )
    await page
      .getByRole("button", { name: "View full email", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    await dialog
      .getByLabel("Purpose of access", { exact: true })
      .fill("Permission revocation investigation")
    await dialog
      .getByRole("button", { name: "View full email", exact: true })
      .click()
    await expectUI(dialog.getByRole("status")).toHaveText(target.email)
    await environment.deployerPool.query(
      "UPDATE public.platform_assignment SET role = 'platform_auditor' WHERE user_id = $1",
      [actor.user.id]
    )
    await dialog
      .getByRole("button", { name: "View full email", exact: true })
      .click()
    await expectUI(dialog).not.toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "View full email", exact: true })
    ).toHaveCount(0)
    expect(await page.locator("body").innerText()).not.toContain(target.email)
    await expectUI(
      page.getByRole("heading", {
        name: "Organization memberships",
        exact: true,
      })
    ).toBeVisible()
  })

  it("shows loading, retry and empty directory states without exposing partial identities", async () => {
    const page = await pageFor(auditor)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/platform/users?**", async (route) => {
      await gate
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "AUDIT_UNAVAILABLE",
          message: "Audit unavailable",
          locale: "en-US",
          requestId: randomUUID(),
        }),
      })
    })
    try {
      await page.goto(`${environment.platformOrigin}/platform/users?q=Browser`)
      await expectUI(
        page.locator('[role="status"][aria-busy="true"]')
      ).toBeVisible()
      expect(await page.locator("main").innerText()).not.toContain(target.email)
    } finally {
      release()
    }
    await expectUI(page.getByRole("alert")).toBeVisible()
    await page.unroute("**/api/v1/platform/users?**")
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await page
      .getByLabel("Search name, user ID or masked email")
      .fill("no-such-directory-user")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
  })
})
