import { randomBytes, randomUUID } from "node:crypto"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { expect as expectUI } from "playwright/test"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

describe("S8-09：浏览器中的个人与组织语言设置", () => {
  let environment
  let browser
  let context
  let page
  let tenantOrigin
  let account

  beforeAll(async () => {
    environment = await startBrowserApplication()
    ;({ browser, tenantOrigin } = environment)
  })

  beforeEach(async () => {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    page = await context.newPage()
  })

  afterEach(async () => {
    await context?.close()
  })

  afterAll(async () => {
    await environment?.close()
  })

  it("无组织时刷新恢复已保存的个人语言偏好", async () => {
    const account = await signUpVerified(
      environment.baseURL,
      tenantOrigin,
      environment.migrator,
      {
        name: "无组织语言用户",
        email: `locale-no-org-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      }
    )
    await page.goto(`${tenantOrigin}/login`)
    await page.getByLabel("邮箱", { exact: true }).fill(account.user.email)
    await page.getByLabel("密码", { exact: true }).fill(account.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
    await page.goto(`${tenantOrigin}/app/settings/preferences`)
    const localeSelect = page.getByRole("combobox", {
      name: "语言",
      exact: true,
    })
    await localeSelect.focus()
    await expectUI(localeSelect).toBeFocused()
    await localeSelect.press("Enter")
    await page.keyboard.press("End")
    await page.keyboard.press("Enter")
    await expectUI(localeSelect).toContainText("العربية")
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")

    await page.reload()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expectUI(
      page.getByRole("combobox", { name: "اللغة", exact: true })
    ).toBeVisible()
  })

  it("切换到无偏好的无组织账号时按继承语言复位，响应语言仍跟随请求头", async () => {
    const accountA = await signUpVerified(
      environment.baseURL,
      tenantOrigin,
      environment.migrator,
      {
        name: "阿语偏好账号",
        email: `locale-account-a-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      }
    )
    const accountB = await signUpVerified(
      environment.baseURL,
      tenantOrigin,
      environment.migrator,
      {
        name: "平台默认账号",
        email: `locale-account-b-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      }
    )

    const updateResponse = await fetch(
      `${environment.baseURL}/api/v1/me/preferences`,
      {
        method: "PATCH",
        headers: {
          cookie: accountA.cookie,
          origin: tenantOrigin,
          "content-type": "application/json",
          "accept-language": "zh-CN",
        },
        body: JSON.stringify({ preferredLocale: "ar", expectedVersion: 1 }),
      }
    )
    expect(updateResponse.status).toBe(200)
    expect(updateResponse.headers.get("content-language")).toBe("zh-CN")
    expect(await updateResponse.json()).toMatchObject({
      preferredLocale: "ar",
      effectiveLocale: "ar",
      effectiveLocaleSource: "user",
    })

    const defaultResponse = await fetch(
      `${environment.baseURL}/api/v1/me/preferences`,
      {
        headers: {
          cookie: accountB.cookie,
          origin: tenantOrigin,
          "accept-language": "ar",
        },
      }
    )
    expect(defaultResponse.status).toBe(200)
    expect(defaultResponse.headers.get("content-language")).toBe("ar")
    expect(await defaultResponse.json()).toMatchObject({
      preferredLocale: null,
      effectiveLocale: "zh-CN",
      effectiveLocaleSource: "platform",
    })

    await page.goto(`${tenantOrigin}/login`)
    await page.getByLabel("邮箱", { exact: true }).fill(accountA.user.email)
    await page.getByLabel("密码", { exact: true }).fill(accountA.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")

    await page
      .getByRole("button", { name: "تسجيل الخروج", exact: true })
      .click()
    await expectUI(
      page.getByLabel("البريد الإلكتروني", { exact: true })
    ).toBeVisible()

    const accountBPreferences = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith("/api/v1/me/preferences")
    )
    await page
      .getByLabel("البريد الإلكتروني", { exact: true })
      .fill(accountB.user.email)
    await page
      .getByLabel("كلمة المرور", { exact: true })
      .fill(accountB.password)
    await page
      .getByRole("button", { name: "تسجيل الدخول", exact: true })
      .click()
    await expectUI(page).toHaveURL(/\/app(?:\/|$)/)

    const preferencesResponse = await accountBPreferences
    expect(preferencesResponse.request().headers()["accept-language"]).toBe(
      "ar"
    )
    expect(preferencesResponse.headers()["content-language"]).toBe("ar")
    expect(await preferencesResponse.json()).toMatchObject({
      preferredLocale: null,
      effectiveLocale: "zh-CN",
      effectiveLocaleSource: "platform",
    })
    await expectUI(page.locator("html")).toHaveAttribute("lang", "zh-CN")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "ltr")
    await expectUI(
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toBeVisible()
  })

  it("个人偏好读取失败时展示可访问错误状态", async () => {
    const account = await signUpVerified(
      environment.baseURL,
      tenantOrigin,
      environment.migrator,
      {
        name: "语言错误状态用户",
        email: `locale-error-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      }
    )
    let preferenceRequests = 0
    await page.route("**/api/v1/me/preferences", async (route) => {
      preferenceRequests += 1
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          message: "Unavailable",
          requestId: "locale-load-failure-e2e",
          locale: "zh-CN",
        }),
      })
    })

    await page.goto(`${tenantOrigin}/login`)
    await page.getByLabel("邮箱", { exact: true }).fill(account.user.email)
    await page.getByLabel("密码", { exact: true }).fill(account.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
    await page.goto(`${tenantOrigin}/app/settings/preferences`)
    await expectUI(page.getByRole("alert")).toHaveText("语言设置加载失败。", {
      timeout: 15000,
    })
    expect(preferenceRequests).toBeGreaterThan(0)
  })

  it("继承组织语言、保存个人偏好并在版本冲突后保留草稿", async () => {
    account = await signUpVerified(
      environment.baseURL,
      tenantOrigin,
      environment.migrator,
      {
        name: "语言设置管理员",
        email: `locale-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      }
    )
    // 浏览器登录负责建立页面会话；服务端 API 用同一身份模拟并发管理员写入。
    await page.goto(`${tenantOrigin}/login`)
    await page.getByLabel("邮箱", { exact: true }).fill(account.user.email)
    await page.getByLabel("密码", { exact: true }).fill(account.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toBeVisible()

    const firstOrganization = {
      name: "语言组织甲",
      slug: `locale-a-${randomUUID()}`,
    }
    await page
      .getByLabel("组织名称", { exact: true })
      .fill(firstOrganization.name)
    await page
      .getByLabel("组织标识", { exact: true })
      .fill(firstOrganization.slug)
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "项目", exact: true })
    ).toBeVisible()
    const organizations = await environment.migrator.query(
      "SELECT id FROM organization WHERE slug = $1",
      [firstOrganization.slug]
    )
    const firstOrganizationId = organizations.rows[0].id
    await page.getByRole("link", { name: "组织语言设置", exact: true }).click()
    await page.getByRole("combobox", { name: "语言", exact: true }).click()
    await page.getByRole("option", { name: "English", exact: true }).click()
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    await expectUI(
      page.getByRole("heading", {
        name: "Organization language settings",
        exact: true,
      })
    ).toBeVisible()

    await page
      .getByRole("link", { name: "Personal language settings", exact: true })
      .click()
    await page.getByRole("combobox", { name: "Language", exact: true }).click()
    await page.getByRole("option", { name: "العربية", exact: true }).click()
    await page.getByRole("button", { name: /保存|Save|حفظ/ }).click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")

    await page.locator('a[href^="/app/projects/"]').first().click()
    await page.getByRole("button", { name: /语言设置管理员/ }).click()
    await page.getByRole("menuitem", { name: "اللغة", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "English", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    await page
      .getByRole("link", { name: "Personal language settings", exact: true })
      .click()
    await expectUI(
      page.getByRole("combobox", { name: "Language", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    await page.getByRole("button", { name: /语言设置管理员/ }).click()
    await page.getByRole("menuitem", { name: "Language", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "العربية", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")

    await page.getByRole("combobox", { name: "اللغة", exact: true }).click()
    await page
      .getByRole("option", {
        name: "اتباع الإعدادات الافتراضية للمؤسسة أو المنصة",
        exact: true,
      })
      .click()
    await page.getByRole("button", { name: "حفظ", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")

    const createHeaders = []
    page.on("request", (request) => {
      if (request.url().endsWith("/api/auth/organization/create"))
        createHeaders.push(request.headers()["accept-language"])
    })
    await page.getByRole("button", { name: /语言组织甲/ }).click()
    await page
      .getByRole("menuitem", { name: "Create organization", exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    const secondOrganization = {
      name: "语言组织乙",
      slug: `locale-b-${randomUUID()}`,
    }
    await dialog
      .getByLabel("Organization name", { exact: true })
      .fill(secondOrganization.name)
    await dialog
      .getByLabel("Organization identifier", { exact: true })
      .fill(secondOrganization.slug)
    const createResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/organization/create")
    )
    await dialog
      .getByRole("button", { name: "Create organization", exact: true })
      .click()
    await createResponse
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    expect(createHeaders).toEqual(["en-US"])
    const second = await environment.migrator.query(
      "SELECT id, default_locale_version FROM organization WHERE slug = $1",
      [secondOrganization.slug]
    )
    const secondOrganizationId = second.rows[0].id

    await page.getByRole("button", { name: /语言设置管理员/ }).click()
    await page.getByRole("menuitem", { name: "Language", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "العربية", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")

    const switchHeaders = []
    page.on("request", (request) => {
      if (request.url().endsWith("/api/auth/organization/set-active"))
        switchHeaders.push(request.headers()["accept-language"])
    })
    const switchOrganization = async (currentName, nextName) => {
      await page.getByRole("button", { name: new RegExp(currentName) }).click()
      const response = page.waitForResponse((item) =>
        item.url().endsWith("/api/auth/organization/set-active")
      )
      await page.getByRole("menuitem", { name: new RegExp(nextName) }).click()
      await response
      await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    }
    await switchOrganization("语言组织乙", "语言组织甲")
    await switchOrganization("语言组织甲", "语言组织乙")
    expect(switchHeaders).toEqual(["ar", "ar"])

    await page.getByRole("button", { name: /语言设置管理员/ }).click()
    await page.getByRole("menuitem", { name: "اللغة", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "简体中文", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "zh-CN")

    await page.getByRole("link", { name: "组织语言设置", exact: true }).click()
    await page.getByRole("combobox", { name: "语言", exact: true }).click()
    await page.getByRole("option", { name: "العربية", exact: true }).click()
    const externalWrite = await fetch(
      `${environment.baseURL}/api/v1/organizations/${secondOrganizationId}/settings`,
      {
        method: "PATCH",
        headers: {
          cookie: account.cookie,
          origin: tenantOrigin,
          "content-type": "application/json",
          "accept-language": "zh-CN",
        },
        body: JSON.stringify({ defaultLocale: "en-US", expectedVersion: 1 }),
      }
    )
    expect(externalWrite.status).toBe(200)
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expectUI(page.getByRole("alert")).toContainText(
      "设置已被其他管理员修改"
    )
    const localeControls = page.getByRole("combobox")
    if ((await localeControls.count()) === 0)
      throw new Error(await page.locator("body").innerText())
    await expectUI(localeControls.last()).toContainText("العربية")
    await page.getByRole("button", { name: "保存", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    expect(firstOrganizationId).not.toBe(secondOrganizationId)

    await environment.migrator.query(
      `INSERT INTO organization_role (id, organization_id, role, permission)
       VALUES ($1, $2, 'locale_reader', $3)`,
      [
        randomUUID(),
        secondOrganizationId,
        JSON.stringify({ tenantSettings: ["read"] }),
      ]
    )
    const backupOwner = await signUpVerified(
      environment.baseURL,
      tenantOrigin,
      environment.migrator,
      {
        name: "备用组织所有者",
        email: `locale-owner-${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      }
    )
    await environment.migrator.query(
      `INSERT INTO member (id, organization_id, user_id, role, created_at)
       VALUES ($1, $2, $3, 'owner', now())`,
      [randomUUID(), secondOrganizationId, backupOwner.user.id]
    )
    await environment.migrator.query(
      `UPDATE member SET role = 'locale_reader'
       WHERE organization_id = $1 AND user_id = $2`,
      [secondOrganizationId, account.user.id]
    )
    await page.reload()
    const navigation = page.getByRole("navigation", {
      name: "التنقل الرئيسي",
    })
    await expectUI(
      navigation.getByRole("link", {
        name: "إعدادات لغة المؤسسة",
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByText("يمكنك عرض إعدادات هذه المؤسسة، ولكن لا يمكنك تغييرها.", {
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByRole("combobox", { name: "اللغة", exact: true })
    ).toBeDisabled()
    await expectUI(
      page.getByRole("button", { name: "حفظ", exact: true })
    ).toHaveCount(0)

    await environment.migrator.query(
      `UPDATE member SET role = 'member'
       WHERE organization_id = $1 AND user_id = $2`,
      [secondOrganizationId, account.user.id]
    )
    await page.reload()
    await expectUI(
      navigation.getByRole("link", {
        name: "إعدادات لغة المؤسسة",
        exact: true,
      })
    ).toHaveCount(0)
  })
})
