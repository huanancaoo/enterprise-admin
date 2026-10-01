import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform settings browser workflow", () => {
  let environment, admin, auditor, ordinary, page
  const address = () => `${environment.platformOrigin}/platform/settings`
  beforeAll(async () => {
    environment = await startBrowserApplication()
    await environment.migrator
      .query(`CREATE TABLE public.issue23_browser_facts(fact jsonb NOT NULL);
    CREATE FUNCTION public.issue23_browser_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN INSERT INTO public.issue23_browser_facts VALUES(to_jsonb(NEW)); RETURN NEW; END; $$;
    CREATE TRIGGER issue23_browser_capture AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue23_browser_capture();`)
    admin = await platformOperator(environment, environment.platformOrigin)
    auditor = await platformOperator(
      environment,
      environment.platformOrigin,
      "platform_auditor"
    )
    ordinary = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator
    )
  })
  afterAll(async () => {
    await environment?.close()
  })
  afterEach(async ({ task }) => {
    if (task.result?.state === "fail" && page && !page.isClosed())
      console.error(page.url(), await page.locator("body").innerText())
    await page?.context().close()
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
    page = await context.newPage()
    return page
  }
  async function choose(label, option) {
    await page.getByRole("combobox", { name: label }).click()
    await page.getByRole("option", { name: option, exact: true }).click()
  }
  async function axe() {
    await page
      .locator("main")
      .evaluate(async (element) =>
        Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished)
        )
      )
    const library = createRequire(resolve("apps/storybook/package.json"))
    await page.addScriptTag({ path: library.resolve("axe-core/axe.min.js") })
    const violations = await page.evaluate(
      async () =>
        (
          await window.axe.run(document.querySelector("main"), {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations
    )
    expect(violations).toEqual([])
  }
  async function externallySet(locale) {
    const headers = {
      cookie: admin.cookie,
      origin: environment.platformOrigin,
      "content-type": "application/json",
    }
    const get = await fetch(`${environment.baseURL}/api/v1/platform/settings`, {
      headers,
    })
    const current = await get.json()
    const update = await fetch(
      `${environment.baseURL}/api/v1/platform/settings`,
      {
        method: "PATCH",
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        body: JSON.stringify({
          platformDefaultLocale: locale,
          expectedVersion: current.version,
          reason: "Another settings operator changed it",
        }),
      }
    )
    expect(update.status).toBe(200)
  }

  it("shows loading and a safe summary, saves with keyboard and disables repeated submission", async () => {
    await pageFor(admin)
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route("**/api/v1/platform/settings", async (route) => {
      if (route.request().method() === "GET") await gate
      await route.continue()
    })
    await page.goto(address())
    await expectUI(
      page.locator('[role="status"][aria-busy="true"]')
    ).toBeVisible()
    release()
    await expectUI(
      page.getByLabel("Default language", { exact: true })
    ).toBeVisible()
    await page.unroute("**/api/v1/platform/settings")
    await choose("Default language", "English")
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Browser platform language change")
    let releaseWrite
    const writing = new Promise((resolve) => {
      releaseWrite = resolve
    })
    let count = 0
    const responses = []
    await page.route("**/api/v1/platform/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        count++
        await writing
      }
      const response = await route.fetch(),
        body = await response.text()
      responses.push(body)
      await route.fulfill({ response, body })
    })
    const save = page.getByRole("button", { name: "Save", exact: true })
    await save.focus()
    await page.keyboard.press("Enter")
    await expectUI(page.locator('form[aria-busy="true"]')).toBeVisible()
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toBeDisabled()
    releaseWrite()
    await expectUI(
      page.getByText("Platform default language saved.", { exact: true })
    ).toBeVisible()
    expect(count).toBe(1)
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("")
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    for (const body of responses)
      for (const value of [
        environment.config.secret,
        environment.config.databaseURL,
        environment.config.email.from.email,
      ])
        expect(body).not.toContain(value)
    await axe()
    await page.reload()
    await expectUI(page.getByRole("combobox")).toContainText("English")
  })

  for (const [
    locale,
    title,
    localeLabel,
    reasonLabel,
    saveLabel,
    invalidLabel,
    savedLabel,
  ] of [
    [
      "zh-CN",
      "平台设置",
      "默认语言",
      "修改理由",
      "保存",
      "请输入 10–500 字的操作原因。",
      "平台默认语言已保存。",
    ],
    [
      "ar",
      "إعدادات المنصة",
      "اللغة الافتراضية",
      "سبب التغيير",
      "حفظ",
      "أدخل سببًا من 10 إلى 500 حرف.",
      "تم حفظ اللغة الافتراضية للمنصة.",
    ],
  ])
    it(`provides ${locale} validation, corrected submission, RTL and accessible keyboard operation`, async () => {
      await pageFor(admin, locale)
      await page.goto(address())
      await expectUI(
        page.getByRole("heading", { name: title, exact: true })
      ).toBeVisible()
      await expectUI(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr"
      )
      await page.getByLabel(reasonLabel, { exact: true }).fill("          ")
      await page.getByRole("button", { name: saveLabel, exact: true }).click()
      await expectUI(page.locator('[data-invalid="true"]')).toContainText(
        invalidLabel
      )
      await page
        .getByLabel(reasonLabel, { exact: true })
        .fill("默认语言设置 / تغيير اللغة")
      const selector = page.getByRole("combobox", { name: localeLabel })
      await selector.focus()
      await page.keyboard.press("Enter")
      await page.getByRole("option", { name: "简体中文", exact: true }).click()
      await page.getByRole("button", { name: saveLabel, exact: true }).focus()
      await page.keyboard.press("Enter")
      await expectUI(page.getByText(savedLabel, { exact: true })).toBeVisible()
      await axe()
      await page.screenshot({
        path: `/private/tmp/enterprise-admin-issue23-${locale}.png`,
        fullPage: true,
      })
    })

  it("preserves failed drafts, replays an unknown result once and explicitly reloads a stale version", async () => {
    await pageFor(admin)
    await page.goto(address())
    await choose("Default language", "العربية")
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Preserve this reason after an unknown result")
    const writes = []
    let operation
    await page.route("**/api/v1/platform/settings", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue()
      writes.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      })
      const response = await route.fetch()
      expect(response.status()).toBe(200)
      operation = (await response.json()).operationId
      await route.abort("failed")
    })
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("Preserve this reason after an unknown result")
    await page.unroute("**/api/v1/platform/settings")
    await page.route("**/api/v1/platform/settings", async (route) => {
      if (route.request().method() === "PATCH")
        writes.push({
          body: route.request().postData(),
          key: route.request().headers()["idempotency-key"],
        })
      await route.continue()
    })
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(
      page.getByText("Platform default language saved.", { exact: true })
    ).toBeVisible()
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    const facts = await environment.migrator.query(
      "SELECT fact FROM issue23_browser_facts WHERE fact->>'operation_id'=$1",
      [operation]
    )
    expect(facts.rows).toHaveLength(1)
    await page.unroute("**/api/v1/platform/settings")
    await externallySet("en-US")
    await choose("Default language", "简体中文")
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Keep stale reason until explicit reload")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("Keep stale reason until explicit reload")
    await page
      .getByRole("button", {
        name: "Discard draft and reload latest settings",
        exact: true,
      })
      .click()
    await expectUI(page.getByRole("combobox")).toContainText("English")
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("")
  })

  it("shows read errors and retries, keeps audit-failure drafts and denies auditors/ordinary users", async () => {
    await pageFor(admin)
    await environment.migrator
      .query(`CREATE FUNCTION public.issue23_browser_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code IN ('platform.settings_viewed','platform.settings_updated') THEN RAISE EXCEPTION 'browser audit injection'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER issue23_browser_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue23_browser_fail();`)
    await page.goto(address())
    await expectUI(page.getByRole("alert")).toBeVisible()
    await environment.migrator.query(
      "DROP TRIGGER issue23_browser_fail ON public.audit_events; DROP FUNCTION public.issue23_browser_fail()"
    )
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expectUI(page.getByRole("combobox")).toBeVisible()
    await environment.migrator
      .query(`CREATE FUNCTION public.issue23_browser_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='platform.settings_updated' THEN RAISE EXCEPTION 'browser audit injection'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER issue23_browser_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue23_browser_fail();`)
    try {
      await page
        .getByLabel("Reason for change", { exact: true })
        .fill("Audit failure keeps the settings draft")
      await page.getByRole("button", { name: "Save", exact: true }).click()
      await expectUI(page.getByRole("alert")).toBeVisible()
      await expectUI(
        page.getByLabel("Reason for change", { exact: true })
      ).toHaveValue("Audit failure keeps the settings draft")
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER issue23_browser_fail ON public.audit_events; DROP FUNCTION public.issue23_browser_fail()"
      )
    }
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(
      page.getByText("Platform default language saved.", { exact: true })
    ).toBeVisible()
    await page.context().close()
    await pageFor(auditor)
    await page.goto(address())
    await expectUI(
      page.getByText("Your platform auditor role can view these settings.", {
        exact: true,
      })
    ).toBeVisible()
    await expectUI(page.locator("form")).toHaveCount(0)
    await axe()
    await page.context().close()
    await pageFor(ordinary)
    await page.goto(address())
    await expectUI(page).toHaveURL(/platform\/access-denied/)
    await expectUI(
      page.getByText("SMTP configuration", { exact: true })
    ).toHaveCount(0)
  })
})
