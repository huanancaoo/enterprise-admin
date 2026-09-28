import { randomBytes, randomUUID } from "node:crypto"
import { expect as expectUI } from "playwright/test"
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
} from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startBrowserApplication } from "../setup/test-runtime.mjs"

async function signIn(page, origin, account) {
  await page.goto(origin + "/login")
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
}

describe("invitation management and recipient browser flows", () => {
  let environment, context, page
  beforeAll(async () => {
    environment = await startBrowserApplication()
  })
  afterAll(() => environment?.close())
  beforeEach(async () => {
    context = await environment.browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    page = await context.newPage()
  })
  afterEach(() => context.close())

  async function fixture() {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "邀请管理员" }
    )
    const recipient = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "邀请验收组织", slug: randomUUID() },
    })
    return { owner, recipient, org }
  }

  it("keeps failed delivery separate from creation, shows cooldown errors, and cancels via keyboard confirmation", async () => {
    const { owner, recipient, org } = await fixture()
    await signIn(page, environment.tenantOrigin, owner)
    await page.goto(`${environment.tenantOrigin}/app/members/${org.id}`)
    const trigger = page.getByRole("button", { name: "邀请成员", exact: true })
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog")
    await expectUI(dialog.getByLabel("邮箱", { exact: true })).toBeFocused()
    await dialog.getByLabel("邮箱", { exact: true }).fill(recipient.email)
    await dialog.getByRole("button", { name: "发送邀请", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(
      page.getByRole("alert").filter({ hasText: "邀请已创建。 邮件发送失败" })
    ).toBeVisible()
    const list = page.getByRole("list", { name: "邀请", exact: true })
    const row = list.getByRole("listitem").filter({ hasText: recipient.email })
    await expectUI(row).toContainText("待处理")
    await expectUI(row).toContainText("邮件发送失败")
    const resendResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/invite-member") &&
        response.request().method() === "POST"
    )
    await row.getByRole("button", { name: "再次发送", exact: true }).click()
    const response = await resendResponse
    expect(response.status()).toBe(429)
    expect(await response.json()).toMatchObject({
      code: "INVITATION_RESEND_COOLDOWN",
    })
    await expectUI(
      page.getByRole("alert").filter({ hasText: "60 秒" })
    ).toBeVisible()
    await row.getByRole("button", { name: "取消邀请", exact: true }).focus()
    await page.keyboard.press("Enter")
    const confirm = page.getByRole("alertdialog")
    await confirm.getByRole("button", { name: "取消邀请", exact: true }).focus()
    await page.keyboard.press("Enter")
    await expectUI(confirm).toHaveCount(0)
    await expectUI(row).toContainText("已取消")
    await expectUI(
      row.getByRole("button", { name: "再次发送", exact: true })
    ).toHaveCount(0)
  })

  it("rejects only after a recipient action and supports Arabic RTL in a suspended organization", async () => {
    const { owner, recipient, org } = await fixture()
    const invitation = await environment.runtime.auth.api.createInvitation({
      headers: owner.headers,
      body: { organizationId: org.id, email: recipient.email, role: "member" },
    })
    await environment.migrator.query(
      "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
      [org.id]
    )
    await signIn(page, environment.tenantOrigin, recipient)
    await page.goto(
      `${environment.tenantOrigin}/accept-invitation/${invitation.id}`
    )
    await expectUI(
      page.getByRole("button", { name: "接受邀请", exact: true })
    ).toBeVisible()
    // UI 实例通过公开语言控件切换；测试只观察真实页面和原生 HTTP 结果。
    await page.getByRole("button", { name: "语言", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "العربية", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    const reject = page.getByRole("button", { name: "رفض الدعوة", exact: true })
    await reject.focus()
    await page.keyboard.press("Enter")
    await expectUI(page.getByRole("status")).toContainText(
      "لقد رفضت هذه الدعوة."
    )
    const accepted = await page.request.post(
      environment.tenantOrigin + "/api/auth/organization/accept-invitation",
      {
        data: { invitationId: invitation.id },
        headers: { origin: environment.tenantOrigin },
      }
    )
    expect(accepted.status()).toBe(409)
    await expectUI(
      page.getByRole("button", { name: "رفض الدعوة", exact: true })
    ).toHaveCount(0)
  })
})
