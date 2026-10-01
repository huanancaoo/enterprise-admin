import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform audit browser investigation", () => {
  let environment, admin, auditor, tenant, organization, currentPage
  beforeAll(async () => {
    environment = await startBrowserApplication()
    admin = await platformOperator(environment, environment.platformOrigin)
    auditor = await platformOperator(
      environment,
      environment.platformOrigin,
      "platform_auditor"
    )
    tenant = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      {
        name: "Audit browser owner",
        email: "browser-audit-private@example.test",
      }
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: tenant.headers,
      body: {
        name: "Browser audit organization",
        slug: `audit-${randomUUID()}`,
      },
    })
    const client = await environment.runtime.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('app.organization_id',$1,true)", [
        organization.id,
      ])
      await client.query(
        `INSERT INTO public.audit_events(organization_id,scope,event_code,actor_id,resource_type,resource_id,result,request_id,tenant_visible,occurred_at,reason,fields)
        SELECT $1,'tenant','member.role_changed',$2,'member',gen_random_uuid(),'succeeded',gen_random_uuid()::text,true,clock_timestamp()-interval '1 hour','private-browser-reason@example.test',jsonb_build_object('email',$3::text,'token','browser-secret-metadata') FROM generate_series(1,23)`,
        [organization.id, tenant.user.id, tenant.email]
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
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
      'UPDATE public."user" SET preferred_locale=$2 WHERE id=$1',
      [actor.user.id, locale]
    )
    const context = await environment.browser.newContext({
      viewport: { width: 1440, height: 1000 },
    })
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
  async function axe(page, selector = "main") {
    await page.locator(selector).evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished)
      )
    })
    const library = createRequire(resolve("apps/storybook/package.json"))
    await page.addScriptTag({ path: library.resolve("axe-core/axe.min.js") })
    const violations = await page.evaluate(
      async (selector) =>
        (
          await window.axe.run(document.querySelector(selector), {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations,
      selector
    )
    expect(violations).toEqual([])
  }
  const url = () =>
    `${environment.platformOrigin}/platform/audit-events?eventCode=member.role_changed`

  it("requires purpose before reading, paginates, opens an audited detail with keyboard and restores URL filters", async () => {
    const page = await pageFor(admin)
    const requests = [],
      responses = []
    page.on("request", (r) => {
      if (r.url().includes("/api/v1/platform/audit-events"))
        requests.push(r.url())
    })
    // 在正文交给浏览器前保存真实 HTTP 响应，文档刷新会销毁 Chromium 的旧响应句柄。
    await page.route("**/api/v1/platform/audit-events**", async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      if (response.status() === 200) responses.push(body)
      await route.fulfill({ response, body })
    })
    await page.goto(url())
    await expectUI(
      page.getByRole("heading", { name: "Audit", exact: true })
    ).toBeVisible()
    expect(requests).toEqual([])
    await page
      .getByLabel("Purpose of access", { exact: true })
      .fill("Browser issue 22 purpose")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    expect(page.url()).not.toContain("purpose")
    expect(await page.locator("main").innerText()).not.toContain(tenant.email)
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(3)
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    const trigger = page
      .getByRole("button", { name: "Audit details", exact: true })
      .first()
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog")
    await expectUI(dialog.getByText("Event ID", { exact: true })).toBeVisible()
    await expectUI(
      dialog.getByText("member.role_changed", { exact: true })
    ).toBeVisible()
    await axe(page, '[role="dialog"]')
    await dialog.getByRole("button", { name: "Close", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(trigger).toBeFocused()
    await page.getByLabel("Event", { exact: true }).fill("role.deleted")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
    await page.goBack()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await expectUI(page.getByLabel("Event", { exact: true })).toHaveValue(
      "member.role_changed"
    )
    await expectUI(
      page.getByRole("button", { name: "Apply filters", exact: true })
    ).toBeEnabled()
    await page.reload()
    await expectUI(
      page.getByLabel("Purpose of access", { exact: true })
    ).toHaveValue("")
    await expectUI(page.locator("tbody tr")).toHaveCount(0)
    expect(responses.length).toBeGreaterThanOrEqual(5)
    for (const text of responses) {
      for (const value of [
        tenant.email,
        "private-browser-reason@example.test",
        "browser-secret-metadata",
      ])
        expect(text).not.toContain(value)
    }
    expect(
      requests.every(
        (value) =>
          new URL(value).searchParams.get("purpose") ===
          "Browser issue 22 purpose"
      )
    ).toBe(true)
  })

  for (const [
    locale,
    purposeLabel,
    applyLabel,
    detailsLabel,
    closeLabel,
    errorLabel,
  ] of [
    [
      "zh-CN",
      "读取目的",
      "应用筛选",
      "审计详情",
      "关闭",
      "读取目的不能为空，且不能超过 500 个字符。",
    ],
    [
      "ar",
      "غرض الوصول",
      "تطبيق عوامل التصفية",
      "تفاصيل التدقيق",
      "إغلاق",
      "أدخل غرضًا من حرف واحد إلى 500 حرف.",
    ],
  ])
    it(`provides ${locale} validation, RTL, keyboard and accessible list/detail`, async () => {
      const page = await pageFor(auditor, locale)
      await page.goto(url())
      await expectUI(page.locator("html")).toHaveAttribute("lang", locale)
      await expectUI(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr"
      )
      await page.getByLabel(purposeLabel, { exact: true }).fill(" ")
      const apply = page.getByRole("button", { name: applyLabel, exact: true })
      await apply.focus()
      await page.keyboard.press("Enter")
      await expectUI(page.locator('[data-invalid="true"]')).toHaveCount(1)
      await expectUI(page.locator('[data-invalid="true"]')).toContainText(
        errorLabel
      )
      await page
        .getByLabel(purposeLabel, { exact: true })
        .fill("排查平台权限 / غرض التحقيق")
      await apply.focus()
      await page.keyboard.press("Enter")
      await expectUI(page.locator("tbody tr")).toHaveCount(20)
      await axe(page)
      await page
        .getByRole("button", { name: detailsLabel, exact: true })
        .first()
        .focus()
      await page.keyboard.press("Enter")
      const dialog = page.getByRole("dialog")
      await expectUI(
        dialog.getByText("member.role_changed", { exact: true })
      ).toBeVisible()
      await axe(page, '[role="dialog"]')
      await page.screenshot({
        path: `/private/tmp/enterprise-admin-issue22-${locale}.png`,
        fullPage: true,
      })
      await dialog
        .getByRole("button", { name: closeLabel, exact: true })
        .click()
      await expectUI(dialog).toHaveCount(0)
    })

  it("keeps purpose and filter drafts on audit failure, exposes loading, retries and rejects invalid IDs and ranges", async () => {
    const page = await pageFor(admin)
    await page.goto(url())
    await page
      .getByLabel("Purpose of access", { exact: true })
      .fill("Failure retains this purpose")
    await page.getByLabel("Organization ID", { exact: true }).fill("bad-uuid")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.locator('[data-invalid="true"]')).toHaveCount(1)
    await page
      .getByLabel("Organization ID", { exact: true })
      .fill(organization.id)
    await environment.migrator
      .query(`CREATE FUNCTION public.issue22_browser_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_code='platform.audit_queried' THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER issue22_browser_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue22_browser_fail();`)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/platform/audit-events?**", async (route) => {
      await gate
      await route.continue()
    })
    try {
      await page
        .getByRole("button", { name: "Apply filters", exact: true })
        .click()
      await expectUI(
        page.locator('[role="status"][aria-busy="true"]')
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "Apply filters", exact: true })
      ).toBeDisabled()
    } finally {
      release()
    }
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByLabel("Purpose of access", { exact: true })
    ).toHaveValue("Failure retains this purpose")
    await expectUI(
      page.getByLabel("Organization ID", { exact: true })
    ).toHaveValue(organization.id)
    await page.unroute("**/api/v1/platform/audit-events?**")
    await environment.migrator.query(
      "DROP TRIGGER issue22_browser_fail ON public.audit_events; DROP FUNCTION public.issue22_browser_fail()"
    )
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await page
      .getByLabel("From (UTC)", { exact: true })
      .fill("2020-01-01T00:00")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.locator('[data-invalid="true"]')).toHaveCount(1)
    await expectUI(
      page.getByLabel("Purpose of access", { exact: true })
    ).toHaveValue("Failure retains this purpose")
  })

  it("removes restricted audit results after CLI revocation and rejects an ordinary organization owner", async () => {
    const page = await pageFor(auditor)
    await page.goto(url())
    await page
      .getByLabel("Purpose of access", { exact: true })
      .fill("Before assignment revocation")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await promisify(execFile)(
      process.execPath,
      [
        "apps/api/dist/console.js",
        "platform",
        "assignment",
        "revoke",
        "--user-id",
        auditor.user.id,
        "--role",
        "platform_auditor",
        "--reason",
        "browser revoked assignment",
      ],
      {
        env: {
          PATH: process.env.PATH,
          PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
        },
      }
    )
    await page.getByRole("button", { name: "Next page", exact: true }).click()
    await expectUI(page).toHaveURL(/platform\/access-denied/)
    await expectUI(page.locator("tbody tr")).toHaveCount(0)
    await page.context().close()
    const ordinary = await pageFor(tenant)
    await ordinary.goto(url())
    await expectUI(ordinary).toHaveURL(/platform\/access-denied/)
    await expectUI(ordinary.locator("tbody tr")).toHaveCount(0)
  })
})
