import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
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
      // 筛选提交会卸载 Popover，取消它的退出动画也属于正常完成。
      await Promise.allSettled(
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
  async function openFilters(page, locale = "en-US") {
    const label = {
      "en-US": "Advanced filters",
      "zh-CN": "高级筛选",
      ar: "عوامل تصفية متقدمة",
    }[locale]
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).click()
    await expectUI(
      page.getByRole("dialog", { name: label, exact: true })
    ).toBeVisible()
  }
  async function selectEntity(page, entity, query, name) {
    const trigger = page.getByRole("combobox", { name: entity, exact: true })
    await trigger.click()
    await page
      .getByPlaceholder(
        entity === "Organization"
          ? "Search organizations by name, slug, or ID"
          : "Search users by name, masked email, or ID",
        { exact: true }
      )
      .fill(query)
    await page.getByRole("option", { name: new RegExp(name) }).click()
    await expectUI(trigger).toContainText(name)
  }
  const url = () =>
    `${environment.platformOrigin}/platform/audit-events?eventCode=member.role_changed`

  it("loads immediately without a purpose, paginates, opens an audited detail with keyboard and restores URL filters", async () => {
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
      page.getByRole("heading", { name: "Operation logs", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    expect(page.url()).not.toContain("purpose")
    expect(await page.locator("main").innerText()).not.toContain(tenant.email)
    await page.getByRole("button", { name: "2", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(3)
    await page
      .getByRole("button", { name: "Previous page", exact: true })
      .click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    const trigger = page
      .getByRole("button", { name: "Operation log details", exact: true })
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
    await openFilters(page)
    await expectUI(page.getByLabel(/Purpose of access/)).toHaveCount(0)
    await page.keyboard.press("Escape")
    const search = page.getByRole("textbox", {
      name: "Event code (exact match)",
    })
    await search.fill("role.deleted")
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: /^Advanced filters/ })
    ).toBeEnabled()
    await search.fill("member.role_changed")
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await page.goBack()
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
    await page.goBack()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await expectUI(search).toHaveValue("member.role_changed")
    await page.reload()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await expectUI(page.getByLabel(/Purpose of access/)).toHaveCount(0)
    expect(responses.length).toBeGreaterThanOrEqual(5)
    const pages = responses
      .map((text) => JSON.parse(text))
      .filter((body) => Array.isArray(body.items))
    expect(pages.slice(0, 3).map((body) => body.page)).toEqual([1, 2, 1])
    expect(
      pages
        .slice(0, 3)
        .every((body) => body.pageSize === 20 && body.total === 23)
    ).toBe(true)
    expect(pages[1].window).toEqual(pages[0].window)
    expect(pages[2].window).toEqual(pages[0].window)
    for (const text of responses) {
      for (const value of [
        tenant.email,
        "private-browser-reason@example.test",
        "browser-secret-metadata",
      ])
        expect(text).not.toContain(value)
    }
    expect(
      requests.every((value) => !new URL(value).searchParams.has("purpose"))
    ).toBe(true)
  })

  it("changes page size and jumps directly to a numbered page", async () => {
    const page = await pageFor(admin)
    await page.goto(url())
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await page
      .getByRole("combobox", { name: "Rows per page", exact: true })
      .click()
    await page.getByRole("option", { name: "10", exact: true }).click()
    await expectUI(page).toHaveURL(/page=1&pageSize=10/)
    await expectUI(page.locator("tbody tr")).toHaveCount(10)
    await page.getByRole("button", { name: "3", exact: true }).click()
    await expectUI(page).toHaveURL(/page=3&pageSize=10/)
    await expectUI(page.locator("tbody tr")).toHaveCount(3)
    await expectUI(page.getByText("23 rows", { exact: true })).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "Next page", exact: true })
    ).toBeDisabled()
    await openFilters(page)
    const fixedWindow = new URL(page.url()).searchParams
    await selectEntity(page, "Actor", tenant.user.id, tenant.user.name)
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page).toHaveURL(/page=1&pageSize=10/)
    await expectUI(page.locator("tbody tr")).toHaveCount(10)
    expect(new URL(page.url()).searchParams.get("from")).toBe(
      fixedWindow.get("from")
    )
    expect(new URL(page.url()).searchParams.get("to")).toBe(
      fixedWindow.get("to")
    )
    await page.getByRole("button", { name: "Result", exact: true }).click()
    await page.getByRole("option", { name: "Succeeded", exact: true }).click()
    await page.keyboard.press("Escape")
    await expectUI(page).toHaveURL(/result=succeeded/)
    await expectUI(page.locator("tbody tr")).toHaveCount(10)
    expect(new URL(page.url()).searchParams.get("actorId")).toBe(tenant.user.id)
    await axe(page)
    await page.screenshot({
      path: join(tmpdir(), "enterprise-admin-platform-audit-datatable.png"),
      fullPage: true,
    })
  })

  it("selects directory identities as drafts and restores current and historical IDs after reload", async () => {
    const page = await pageFor(admin)
    const reads = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/platform/audit-events")
        reads.push(request.url())
    })
    await page.goto(`${url()}&page=2&pageSize=10`)
    await expectUI(page.locator("tbody tr")).toHaveCount(10)
    await openFilters(page)
    const initialUrl = page.url()
    const initialReads = reads.length
    const org = page.getByRole("combobox", {
      name: "Organization",
      exact: true,
    })
    await org.click()
    const orgSearch = page.getByPlaceholder(
      "Search organizations by name, slug, or ID",
      { exact: true }
    )
    await expectUI(orgSearch).toBeFocused()
    await orgSearch.fill(organization.slug)
    await expectUI(
      page.getByRole("option", { name: new RegExp(organization.name) })
    ).toHaveCount(1)
    await axe(page, '[data-slot="combobox-content"]')
    await orgSearch.press("ArrowDown")
    await orgSearch.press("Enter")
    await expectUI(org).toContainText(organization.name)
    await expectUI(
      page.getByRole("dialog", { name: "Advanced filters", exact: true })
    ).toBeVisible()
    expect(page.url()).toBe(initialUrl)
    expect(reads).toHaveLength(initialReads)

    const actor = page.getByRole("combobox", { name: "Actor", exact: true })
    await actor.click()
    const userSearch = page.getByPlaceholder(
      "Search users by name, masked email, or ID",
      { exact: true }
    )
    await userSearch.fill(tenant.user.id)
    const candidate = page.getByRole("option", {
      name: new RegExp(tenant.user.name),
    })
    await expectUI(candidate).toHaveCount(1)
    await userSearch.press("ArrowDown")
    await userSearch.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      isComposing: true,
    })
    await expectUI(userSearch).toBeVisible()
    expect(page.url()).toBe(initialUrl)
    expect(reads).toHaveLength(initialReads)
    await userSearch.press("Enter")
    await expectUI(actor).toContainText(tenant.user.name)
    await expectUI(actor).not.toContainText(tenant.email)
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page).toHaveURL(/page=1&pageSize=10/)
    const applied = new URL(page.url()).searchParams
    expect(applied.get("organizationId")).toBe(organization.id)
    expect(applied.get("actorId")).toBe(tenant.user.id)
    expect(page.url()).not.toContain(encodeURIComponent(organization.name))
    await expectUI(page.locator("tbody tr")).toHaveCount(10)
    await page.reload()
    await expectUI(page.locator("tbody tr")).toHaveCount(10)
    await openFilters(page)
    await expectUI(org).toContainText(organization.name)
    await expectUI(actor).toContainText(tenant.user.name)
    await org.click()
    await expectUI(orgSearch).toBeVisible()
    await page.keyboard.press("Escape")
    await expectUI(orgSearch).toHaveCount(0)
    await expectUI(
      page.getByRole("dialog", { name: "Advanced filters", exact: true })
    ).toBeVisible()
    await expectUI(org).toBeFocused()
    await page.keyboard.press("Escape")
    await expectUI(
      page.getByRole("dialog", { name: "Advanced filters", exact: true })
    ).toHaveCount(0)

    const historicalId = randomUUID()
    await openFilters(page)
    await expectUI(
      page.getByRole("button", { name: /Filter .* by ID/ })
    ).toHaveCount(0)
    const historicalUrl = new URL(page.url())
    historicalUrl.searchParams.set("organizationId", historicalId)
    await page.goto(historicalUrl.toString())
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
    await openFilters(page)
    await expectUI(org).toContainText(historicalId)
    await expectUI(
      page.getByText("This ID is not in the current directory", { exact: true })
    ).toBeVisible()
    await expectUI(actor).toContainText(tenant.user.name)
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
    await page.reload()
    await expectUI(page.getByText("No results", { exact: true })).toBeVisible()
    await openFilters(page)
    await expectUI(org).toContainText(historicalId)
    await expectUI(actor).toContainText(tenant.user.name)
    const shared = new URL(page.url()).searchParams
    expect(shared.get("organizationId")).toBe(historicalId)
    expect(shared.get("actorId")).toBe(tenant.user.id)
    expect(shared.has("source")).toBe(false)
    expect(shared.has("mode")).toBe(false)
    await axe(page, '[role="dialog"]')
    await page.screenshot({
      path: join(tmpdir(), "enterprise-admin-platform-combobox-history.png"),
      fullPage: true,
    })
  })

  for (const [
    locale,
    fromLabel,
    applyLabel,
    detailsLabel,
    closeLabel,
    errorLabel,
  ] of [
    [
      "zh-CN",
      "开始时间（UTC）",
      "应用筛选",
      "操作日志详情",
      "关闭",
      "请填写有效值；日期范围最多 90 天，结束时间不能晚于当前时间。",
    ],
    [
      "ar",
      "من (UTC)",
      "تطبيق عوامل التصفية",
      "تفاصيل سجل العمليات",
      "إغلاق",
      "أدخل قيمة صحيحة وفترة لا تتجاوز 90 يومًا ولا تنتهي بعد الوقت الحالي.",
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
      await expectUI(page.locator("tbody tr")).toHaveCount(20)
      await openFilters(page, locale)
      await page.getByLabel(fromLabel, { exact: true }).fill("2099-01-01T00:00")
      const apply = page.getByRole("button", { name: applyLabel, exact: true })
      await apply.focus()
      await page.keyboard.press("Enter")
      await expectUI(page.locator('[data-invalid="true"]')).toHaveCount(1)
      await expectUI(page.locator('[data-invalid="true"]')).toContainText(
        errorLabel
      )
      await page.getByLabel(fromLabel, { exact: true }).fill("")
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
        path: join(tmpdir(), `enterprise-admin-issue22-${locale}.png`),
        fullPage: true,
      })
      await dialog
        .getByRole("button", { name: closeLabel, exact: true })
        .click()
      await expectUI(dialog).toHaveCount(0)
    })

  it("keeps filter values on audit failure, exposes loading, retries and rejects invalid ranges", async () => {
    const page = await pageFor(admin)
    await page.goto(url())
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await openFilters(page)
    await selectEntity(page, "Organization", organization.id, organization.name)
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
        page.locator('[data-slot="data-table"][aria-busy="true"]')
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: /^Advanced filters/ })
      ).toBeDisabled()
    } finally {
      release()
    }
    await expectUI(page.getByRole("alert")).toBeVisible()
    await openFilters(page)
    await expectUI(
      page.getByRole("combobox", { name: "Organization", exact: true })
    ).toContainText(organization.name)
    await page.unroute("**/api/v1/platform/audit-events?**")
    await environment.migrator.query(
      "DROP TRIGGER issue22_browser_fail ON public.audit_events; DROP FUNCTION public.issue22_browser_fail()"
    )
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expectUI(page.locator("tbody tr")).toHaveCount(20)
    await openFilters(page)
    await page
      .getByLabel("From (UTC)", { exact: true })
      .fill("2020-01-01T00:00")
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click()
    await expectUI(page.locator('[data-invalid="true"]')).toHaveCount(1)
  })

  it("removes restricted audit results after CLI revocation and rejects an ordinary organization owner", async () => {
    const page = await pageFor(auditor)
    await page.goto(url())
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
