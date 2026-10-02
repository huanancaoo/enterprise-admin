import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("organization storage policy browser workflow", () => {
  let environment, admin, auditor, owner, organization, page
  const address = () =>
    `${environment.platformOrigin}/platform/organizations/${organization.id}`
  const endpoint = () =>
    `${environment.baseURL}/api/v1/platform/organizations/${organization.id}/storage-policy`
  const routePattern = "**/api/v1/platform/organizations/*/storage-policy"
  beforeAll(async () => {
    environment = await startBrowserApplication()
    await environment.migrator
      .query(`CREATE TABLE public.storage_browser_facts(fact jsonb NOT NULL);
      CREATE FUNCTION public.storage_browser_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN INSERT INTO public.storage_browser_facts VALUES(to_jsonb(NEW)); RETURN NEW; END; $$;
      CREATE TRIGGER storage_browser_capture AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.storage_browser_capture();`)
    admin = await platformOperator(environment, environment.platformOrigin)
    auditor = await platformOperator(
      environment,
      environment.platformOrigin,
      "platform_auditor"
    )
    owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Storage acceptance", slug: `storage-${randomUUID()}` },
    })
  })
  afterAll(async () => {
    await environment?.close()
  })
  afterEach(async ({ task }) => {
    if (task.result?.state === "fail" && page && !page.isClosed())
      console.error(page.url(), await page.locator("body").innerText())
    await page?.context().close()
  })
  async function pageFor(actor = admin, locale = "en-US") {
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale=$2 WHERE id=$1',
      [actor.user.id, locale]
    )
    const context = await environment.browser.newContext({
      viewport: { width: 1440, height: 1100 },
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
  }
  async function axe() {
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
  async function externallySet(quotaBytes) {
    const headers = {
      cookie: admin.cookie,
      origin: environment.platformOrigin,
      "content-type": "application/json",
    }
    const response = await fetch(endpoint(), { headers }),
      current = await response.json()
    const updated = await fetch(endpoint(), {
      method: "PATCH",
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        quotaBytes,
        trashDays: 7,
        historyDays: 30,
        reason: "Concurrent storage operator change",
        expectedVersion: current.version,
      }),
    })
    expect(updated.status).toBe(200)
  }

  it("loads the policy in organization details, converts GiB exactly and prevents double submission", async () => {
    await pageFor()
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await page.route(routePattern, async (route) => {
      if (route.request().method() === "GET") await gate
      await route.continue()
    })
    await page.goto(address())
    await expectUI(
      page.getByRole("heading", { name: "Storage policy", exact: true })
    ).toBeVisible()
    await expectUI(
      page.locator('[role="status"][aria-busy="true"]')
    ).toBeVisible()
    release()
    await expectUI(
      page.getByLabel("Storage quota (GiB)", { exact: true })
    ).toHaveValue("10")
    await page.unroute(routePattern)
    await page.getByLabel("Storage quota (GiB)", { exact: true }).fill("0.5")
    await page.getByLabel("Trash retention (days)", { exact: true }).fill("7")
    await page
      .getByLabel("Version history retention (days)", { exact: true })
      .fill("30")
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Browser capacity and retention change")
    let releaseWrite,
      submitted,
      count = 0
    const writing = new Promise((resolve) => {
      releaseWrite = resolve
    })
    await page.route(routePattern, async (route) => {
      if (route.request().method() === "PATCH") {
        count++
        submitted = route.request().postDataJSON()
        await writing
      }
      await route.continue()
    })
    await page.getByRole("button", { name: "Save", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expectUI(page.locator('form[aria-busy="true"]')).toBeVisible()
    await expectUI(
      page.getByLabel("Storage quota (GiB)", { exact: true })
    ).toBeDisabled()
    releaseWrite()
    await expectUI(
      page.getByText("Storage policy saved.", { exact: true })
    ).toBeVisible()
    expect(count).toBe(1)
    expect(submitted).toMatchObject({
      quotaBytes: 536870912,
      trashDays: 7,
      historyDays: 30,
      expectedVersion: 1,
    })
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("")
    await axe()
    await page.reload()
    await expectUI(
      page.getByLabel("Storage quota (GiB)", { exact: true })
    ).toHaveValue("0.5")
    await page.screenshot({
      path: "/private/tmp/enterprise-admin-issue25-storage-policy-en-US.png",
      fullPage: true,
    })
  })

  for (const [locale, title, quota, reason, save, invalid] of [
    [
      "zh-CN",
      "存储策略",
      "存储配额（GiB）",
      "修改理由",
      "保存",
      "请输入非负 GiB 数值，且能精确转换为安全整数 bytes。",
    ],
    [
      "ar",
      "سياسة التخزين",
      "حصة التخزين (GiB)",
      "سبب التغيير",
      "حفظ",
      "أدخل قيمة GiB غير سالبة تتحول بدقة إلى عدد صحيح آمن من البايتات.",
    ],
  ])
    it(`validates ${locale} byte precision and supports keyboard operation with correct direction`, async () => {
      await pageFor(admin, locale)
      await page.goto(address())
      await expectUI(
        page.getByRole("heading", { name: title, exact: true })
      ).toBeVisible()
      await expectUI(page.locator("html")).toHaveAttribute(
        "dir",
        locale === "ar" ? "rtl" : "ltr"
      )
      await page.getByLabel(quota, { exact: true }).fill("0.1")
      await page
        .getByLabel(reason, { exact: true })
        .fill("Precision validation / دقة التخزين")
      await page.getByRole("button", { name: save, exact: true }).click()
      await expectUI(page.locator('[data-invalid="true"]')).toContainText(
        invalid
      )
      await page.getByLabel(quota, { exact: true }).fill("0.25")
      await page.getByRole("button", { name: save, exact: true }).focus()
      await page.keyboard.press("Enter")
      await expectUI(page.getByLabel(reason, { exact: true })).toHaveValue("")
      await axe()
      await page.screenshot({
        path: `/private/tmp/enterprise-admin-issue25-storage-policy-${locale}.png`,
        fullPage: true,
      })
    })

  it("preserves failed drafts and replays unknown results with one receipt, then explicitly reloads conflicts", async () => {
    await pageFor()
    await page.goto(address())
    await page.getByLabel("Storage quota (GiB)", { exact: true }).fill("0.125")
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Keep this draft after an unknown result")
    const writes = []
    let operation
    await page.route(routePattern, async (route) => {
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
    ).toHaveValue("Keep this draft after an unknown result")
    await page.unroute(routePattern)
    await page.route(routePattern, async (route) => {
      if (route.request().method() === "PATCH")
        writes.push({
          body: route.request().postData(),
          key: route.request().headers()["idempotency-key"],
        })
      await route.continue()
    })
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(
      page.getByText("Storage policy saved.", { exact: true })
    ).toBeVisible()
    expect(writes).toHaveLength(2)
    expect(writes[1]).toEqual(writes[0])
    expect(
      (
        await environment.migrator.query(
          "SELECT fact FROM storage_browser_facts WHERE fact->>'operation_id'=$1",
          [operation]
        )
      ).rows
    ).toHaveLength(1)
    await page.unroute(routePattern)
    await externallySet(2 ** 30)
    await page.getByLabel("Storage quota (GiB)", { exact: true }).fill("0.0625")
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Preserve conflicting storage draft")
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("Preserve conflicting storage draft")
    await page
      .getByRole("button", {
        name: "Discard draft and reload latest storage policy",
        exact: true,
      })
      .click()
    await expectUI(
      page.getByLabel("Storage quota (GiB)", { exact: true })
    ).toHaveValue("1")
    await expectUI(
      page.getByLabel("Reason for change", { exact: true })
    ).toHaveValue("")
  })

  it("retries real audit failures without clearing drafts and presents auditors as read-only", async () => {
    await pageFor()
    await environment.migrator
      .query(`CREATE FUNCTION public.storage_browser_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='platform.storage_policy_viewed' THEN RAISE EXCEPTION 'policy read audit fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER storage_browser_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.storage_browser_fail();`)
    try {
      await page.goto(address())
      await expectUI(page.getByRole("alert")).toBeVisible()
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER storage_browser_fail ON public.audit_events; DROP FUNCTION public.storage_browser_fail()"
      )
    }
    await page.getByRole("button", { name: "Retry", exact: true }).click()
    await expectUI(
      page.getByLabel("Storage quota (GiB)", { exact: true })
    ).toBeVisible()
    await environment.migrator
      .query(`CREATE FUNCTION public.storage_browser_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='platform.storage_policy_updated' THEN RAISE EXCEPTION 'policy update audit fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER storage_browser_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.storage_browser_fail();`)
    try {
      await page
        .getByLabel("Reason for change", { exact: true })
        .fill("Audit failure keeps the storage draft")
      await page.getByRole("button", { name: "Save", exact: true }).click()
      await expectUI(page.getByRole("alert")).toBeVisible()
      await expectUI(
        page.getByLabel("Reason for change", { exact: true })
      ).toHaveValue("Audit failure keeps the storage draft")
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER storage_browser_fail ON public.audit_events; DROP FUNCTION public.storage_browser_fail()"
      )
    }
    await page.getByRole("button", { name: "Save", exact: true }).click()
    await expectUI(
      page.getByText("Storage policy saved.", { exact: true })
    ).toBeVisible()
    await page.context().close()
    await pageFor(auditor)
    await page.goto(address())
    await expectUI(
      page.getByText(
        "Your platform auditor role can view this storage policy.",
        { exact: true }
      )
    ).toBeVisible()
    await expectUI(
      page.getByLabel("Storage quota (GiB)", { exact: true })
    ).toHaveCount(0)
    await axe()
    await page.context().close()
    await pageFor(owner)
    await page.goto(address())
    await expectUI(page).toHaveURL(/platform\/access-denied/)
    await expectUI(
      page.getByText("Storage policy", { exact: true })
    ).toHaveCount(0)
  })

  it("redirects stale MFA to verification and removes the policy form", async () => {
    await pageFor()
    await page.goto(address())
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Reverify the storage administrator")
    await environment.migrator.query(
      "UPDATE platform_session_assurance SET verified_at=clock_timestamp()-interval '16 minutes' WHERE user_id=$1",
      [admin.user.id]
    )
    try {
      await page.getByRole("button", { name: "Save", exact: true }).click()
      await expectUI(page).toHaveURL(/platform\/mfa/)
      await expectUI(
        page.getByLabel("Storage quota (GiB)", { exact: true })
      ).toHaveCount(0)
    } finally {
      await environment.migrator.query(
        "UPDATE platform_session_assurance SET verified_at=clock_timestamp() WHERE user_id=$1",
        [admin.user.id]
      )
    }
  })
})
