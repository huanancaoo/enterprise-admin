import { randomBytes } from "node:crypto"
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
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startBrowserApplication } from "../setup/test-runtime.mjs"

async function signIn(page, account) {
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
}

async function selectLocale(page, userName, locale) {
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  await page.getByRole("menuitem", { name: "语言", exact: true }).click()
  const option = page.getByRole("menuitemradio", { name: locale, exact: true })
  await expectUI(option).toBeVisible()
  await option.focus()
  await page.keyboard.press("Enter")
}

describe("S8-05：组织自定义角色浏览器流程", () => {
  let environment
  let context
  let page

  beforeAll(async () => {
    environment = await startBrowserApplication()
  })

  beforeEach(async () => {
    context = await environment.browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    page = await context.newPage()
  })

  afterEach(async () => {
    await context.close()
  })

  afterAll(async () => {
    await environment?.close()
  })

  it("创建角色并在成员管理中分配", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "角色所有者" }
    )
    const member = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "角色成员" }
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "角色验收组织",
        slug: `role-e2e-${randomBytes(5).toString("hex")}`,
      },
    })
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: organization.id,
        userId: member.user.id,
        role: "member",
      },
    })

    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, owner)
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "角色", exact: true })
    ).toBeVisible()
    await page.getByLabel("角色标识", { exact: true }).fill("project-reader")
    await page
      .getByRole("checkbox", { name: "项目：查看", exact: true })
      .check()
    await page.getByRole("button", { name: "创建角色", exact: true }).click()
    await expectUI(
      page.getByText("project-reader", { exact: true })
    ).toBeVisible()

    await page.getByRole("link", { name: "成员", exact: true }).click()
    const list = page.getByRole("list", { name: "成员", exact: true })
    const row = list.getByRole("listitem").filter({ hasText: member.email })
    await row.getByRole("button", { name: "更改角色", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("角色", { exact: true }).click()
    await page
      .getByRole("option", { name: "project-reader", exact: true })
      .click()
    await dialog.getByRole("button", { name: "保存", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(row).toContainText("project-reader")
    expect(page.url()).toContain("/app/members/")
  })

  it("在阿语 RTL 下支持键盘创建、校验错误和重复角色错误", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "RTL角色所有者" }
    )
    await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "RTL角色验收组织",
        slug: `role-rtl-e2e-${randomBytes(5).toString("hex")}`,
      },
    })

    await page.goto(environment.tenantOrigin + "/app/")
    await signIn(page, owner)
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await selectLocale(page, "RTL角色所有者", "العربية")
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")

    await expectUI(
      page.getByRole("heading", { name: "الأدوار", exact: true })
    ).toBeVisible()
    const roleKey = page.getByLabel("مفتاح الدور", { exact: true })
    await expectUI(roleKey).toBeVisible()
    await expectUI(
      page.getByText(
        "استخدم 3–48 حرفاً صغيراً أو رقماً أو شرطة. المفاتيح التي تبدأ بـ platform محجوزة. لا يمكن تغيير المفتاح لاحقاً.",
        { exact: true }
      )
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "إنشاء دور", exact: true })
    ).toBeVisible()

    await roleKey.fill("platformer")
    await page.getByRole("button", { name: "إنشاء دور", exact: true }).click()
    await expectUI(roleKey).toHaveAttribute("aria-invalid", "true")
    await expectUI(
      page.getByText(
        "أدخل مفتاح دور صالحاً؛ لا يُسمح بالأسماء المحجوزة أو المفاتيح التي تبدأ بـ platform.",
        { exact: true }
      )
    ).toBeVisible()

    await roleKey.fill("")
    await roleKey.focus()
    await page.keyboard.type("-keyboard-reader")
    await expectUI(roleKey).toHaveValue("-keyboard-reader")
    const permission = page.getByRole("checkbox").first()
    await page.keyboard.press("Tab")
    await expectUI(permission).toBeFocused()
    await page.keyboard.press("Space")
    await expectUI(permission).toBeChecked()
    await page.keyboard.press("Shift+Tab")
    await expectUI(roleKey).toBeFocused()
    await page.keyboard.press("Tab")
    const checkboxes = page.getByRole("checkbox")
    const checkboxCount = await checkboxes.count()
    for (let index = 0; index < checkboxCount; index += 1) {
      await page.keyboard.press("Tab")
    }
    const createButton = page.getByRole("button", {
      name: "إنشاء دور",
      exact: true,
    })
    await expectUI(createButton).toBeFocused()
    await page.keyboard.press("Enter")
    await expectUI(
      page.getByText("-keyboard-reader", { exact: true })
    ).toBeVisible()

    await roleKey.fill("-keyboard-reader")
    await permission.check()
    await createButton.click()
    const errorAlert = page.getByRole("alert")
    await expectUI(errorAlert).toBeVisible()
    await expectUI(errorAlert).not.toBeEmpty()
    await expectUI(errorAlert).toHaveText(
      "مفتاح الدور مستخدم بالفعل في هذه المؤسسة."
    )
    await expectUI(roleKey).toHaveValue("-keyboard-reader")
  })
})
