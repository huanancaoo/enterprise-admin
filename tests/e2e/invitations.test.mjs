import { randomBytes, randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
import { startSmtpAmbiguityServer } from "../setup/smtp-ambiguity.mjs"

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
    const resend = row.getByRole("button", { name: "再次发送", exact: true })
    await resend.focus()
    await page.keyboard.press("Enter")
    const response = await resendResponse
    expect(response.status()).toBe(429)
    expect(await response.json()).toMatchObject({
      code: "INVITATION_RESEND_COOLDOWN",
    })
    await expectUI(
      page.getByRole("alert").filter({ hasText: "60 秒" })
    ).toBeVisible()
    await expectUI(resend).toBeEnabled()
    await expectUI(resend).toBeFocused()
    await row.getByRole("button", { name: "取消邀请", exact: true }).focus()
    await page.keyboard.press("Enter")
    const confirm = page.getByRole("alertdialog")
    const cancelSent = Promise.withResolvers()
    const releaseCancellation = Promise.withResolvers()
    await page.route("**/organization/cancel-invitation", async (route) => {
      // 实际请求先在服务器完成；只暂缓原响应，观察页面的提交锁定与 Escape。
      const response = await route.fetch()
      cancelSent.resolve(response.status())
      await releaseCancellation.promise
      await route.fulfill({ response })
    })
    try {
      await confirm
        .getByRole("button", { name: "取消邀请", exact: true })
        .focus()
      await page.keyboard.press("Enter")
      expect(await cancelSent.promise).toBe(200)
      await expectUI(confirm).toHaveAttribute("aria-busy", "true")
      await expectUI(
        confirm.getByRole("button", { name: "正在取消…", exact: true })
      ).toBeDisabled()
      await expectUI(
        confirm.getByRole("button", { name: "取消", exact: true })
      ).toBeDisabled()
      await page.keyboard.press("Escape")
      await expectUI(confirm).toBeVisible()
    } finally {
      releaseCancellation.resolve()
    }
    await expectUI(confirm).toHaveCount(0)
    await expectUI(row).toContainText("已取消")
    await expectUI(
      row.getByRole("button", { name: "再次发送", exact: true })
    ).toHaveCount(0)
    await expectUI(
      page.getByRole("heading", { name: "邀请", exact: true })
    ).toBeFocused()
    expect(
      (
        await environment.migrator.query(
          "SELECT status FROM invitation WHERE organization_id = $1 AND email = $2",
          [org.id, recipient.email]
        )
      ).rows
    ).toEqual([{ status: "canceled" }])
  })

  it("保留真实重复邀请冲突的草稿，手动修正后创建，且无未处理页面异常", async () => {
    const { owner, recipient, org } = await fixture()
    const existing = await environment.runtime.auth.api.createInvitation({
      headers: owner.headers,
      body: { organizationId: org.id, email: recipient.email, role: "member" },
    })
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await signIn(page, environment.tenantOrigin, owner)
    await page.goto(`${environment.tenantOrigin}/app/members/${org.id}`)
    await page.getByRole("button", { name: "邀请成员", exact: true }).click()
    const dialog = page.getByRole("dialog")
    const email = dialog.getByLabel("邮箱", { exact: true })
    await email.fill(recipient.email)
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/invite-member") &&
        response.request().method() === "POST"
    )
    const submit = dialog.getByRole("button", { name: "发送邀请", exact: true })
    await submit.focus()
    await page.keyboard.press("Enter")
    const conflict = await rejected
    expect(conflict.status()).toBe(409)
    const problem = await conflict.json()
    expect(problem.code).toBe("INVITATION_ALREADY_PENDING")
    await expectUI(dialog.getByRole("alert")).toContainText(problem.message)
    await expectUI(email).toHaveValue(recipient.email)
    await expectUI(submit).toBeEnabled()
    const replacement = `corrected.${randomUUID()}@example.test`
    await email.fill(replacement)
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/invite-member") &&
        response.request().method() === "POST"
    )
    await submit.focus()
    await page.keyboard.press("Enter")
    const response = await submitted
    expect(response.status()).toBe(200)
    const created = await response.json()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(
      page.getByRole("listitem").filter({ hasText: replacement })
    ).toContainText("待处理")
    const persisted = await environment.migrator.query(
      "SELECT id, email, status FROM invitation WHERE organization_id = $1",
      [org.id]
    )
    expect(persisted.rows).toHaveLength(2)
    expect(persisted.rows).toEqual(
      expect.arrayContaining([
        { id: existing.id, email: recipient.email, status: "pending" },
        { id: created.id, email: replacement, status: "pending" },
      ])
    )
    expect(pageErrors).toEqual([])
  })

  it("委派邀请动作可创建与取消自定义角色邀请，不能读取角色目录或邀请 owner", async () => {
    const { owner, recipient: manager, org } = await fixture()
    for (const [role, permission] of [
      [
        "invitation-manager",
        {
          project: ["read"],
          member: ["read"],
          invitation: ["create", "cancel"],
        },
      ],
      ["project-editor", { project: ["read", "update"] }],
    ])
      await environment.runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: { organizationId: org.id, role, permission },
      })
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: manager.user.id,
        role: "invitation-manager",
      },
    })
    const protectedEmail = `admin.${randomUUID()}@example.test`
    await environment.runtime.auth.api.createInvitation({
      headers: owner.headers,
      body: { organizationId: org.id, email: protectedEmail, role: "admin" },
    })
    const pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await signIn(page, environment.tenantOrigin, manager)
    await page.goto(`${environment.tenantOrigin}/app/members/${org.id}`)
    const list = page.getByRole("list", { name: "邀请", exact: true })
    await expectUI(
      list
        .getByRole("listitem")
        .filter({ hasText: protectedEmail })
        .getByRole("button")
    ).toHaveCount(0)
    const catalog = await context.request.get(
      `${environment.tenantOrigin}/api/auth/organization/list-roles?organizationId=${org.id}`
    )
    expect(catalog.status()).toBe(403)
    await page.getByRole("button", { name: "邀请成员", exact: true }).click()
    const dialog = page.getByRole("dialog")
    const email = `delegated.${randomUUID()}@example.test`
    await dialog.getByLabel("邮箱", { exact: true }).fill(email)
    const role = dialog.getByRole("textbox", { name: "角色", exact: true })
    await role.fill("owner")
    const denied = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/invite-member") &&
        response.request().method() === "POST"
    )
    const submit = dialog.getByRole("button", { name: "发送邀请", exact: true })
    await submit.focus()
    await page.keyboard.press("Enter")
    const deniedResponse = await denied
    expect(deniedResponse.status()).toBe(403)
    expect((await deniedResponse.json()).code).toBe("INVITATION_ROLE_FORBIDDEN")
    await expectUI(dialog.getByRole("alert")).toContainText(
      "你不能邀请该角色。"
    )
    await expectUI(dialog.getByLabel("邮箱", { exact: true })).toHaveValue(
      email
    )
    await expectUI(role).toHaveValue("owner")
    await expectUI(submit).toBeEnabled()
    expect(
      (
        await environment.migrator.query(
          "SELECT id FROM invitation WHERE organization_id = $1 AND email = $2",
          [org.id, email]
        )
      ).rows
    ).toHaveLength(0)
    await role.fill("project-editor")
    const invited = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/invite-member") &&
        response.request().method() === "POST"
    )
    await submit.focus()
    await page.keyboard.press("Enter")
    const invitedResponse = await invited
    expect(invitedResponse.status()).toBe(200)
    const created = await invitedResponse.json()
    await expectUI(dialog).toHaveCount(0)
    const target = list.getByRole("listitem").filter({ hasText: email })
    await expectUI(target).toContainText("project-editor")
    await target.getByRole("button", { name: "取消邀请", exact: true }).focus()
    await page.keyboard.press("Enter")
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "取消邀请", exact: true })
      .press("Enter")
    await expectUI(page.getByRole("alertdialog")).toHaveCount(0)
    await expectUI(target).toContainText("已取消")
    expect(
      (
        await environment.migrator.query(
          "SELECT role, status FROM invitation WHERE id = $1",
          [created.id]
        )
      ).rows
    ).toEqual([{ role: "project-editor", status: "canceled" }])
    expect(
      (
        await environment.migrator.query(
          "SELECT event_code FROM audit_events WHERE organization_id = $1 AND resource_id = $2 ORDER BY occurred_at",
          [org.id, created.id]
        )
      ).rows.map((row) => row.event_code)
    ).toEqual([
      "member.invited",
      "invitation.delivery_failed",
      "invitation.canceled",
    ])
    expect(pageErrors).toEqual([])
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

it("shows the real unknown SMTP result after creation and reload without claiming delivery failed or succeeded", async () => {
  const resources = new AsyncDisposableStack()
  try {
    const smtp = await startSmtpAmbiguityServer()
    resources.defer(() => smtp.close())
    const environment = await startBrowserApplication({ smtp: smtp.smtp })
    resources.defer(() => environment.close())
    const context = await environment.browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    resources.defer(() => context.close())
    const page = await context.newPage()
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "SMTP 结果未知验收" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "SMTP 结果未知组织", slug: randomUUID() },
    })
    const email = `unknown.${randomUUID()}@example.test`
    await signIn(page, environment.tenantOrigin, owner)
    await page.goto(`${environment.tenantOrigin}/app/members/${org.id}`)
    await page.getByRole("button", { name: "邀请成员", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("邮箱", { exact: true }).fill(email)
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/organization/invite-member") &&
        response.request().method() === "POST"
    )
    await dialog.getByRole("button", { name: "发送邀请", exact: true }).focus()
    await page.keyboard.press("Enter")
    const response = await submitted
    expect(response.status()).toBe(200)
    const created = await response.json()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(
      page
        .getByRole("alert")
        .filter({ hasText: "邀请已创建。 邮件投递结果未知" })
    ).toBeVisible()
    const row = page.getByRole("listitem").filter({ hasText: email })
    await expectUI(row).toContainText("待处理")
    await expectUI(row).toContainText("邮件投递结果未知")
    await expectUI(row).not.toContainText("邮件发送失败")
    await expectUI(row).not.toContainText("SMTP 已接受")
    expect(smtp.dataTerminations).toBe(1)
    expect(
      (
        await environment.migrator.query(
          "SELECT id, status FROM invitation WHERE organization_id=$1 AND email=$2",
          [org.id, email]
        )
      ).rows
    ).toEqual([{ id: created.id, status: "pending" }])
    expect(
      (
        await environment.migrator.query(
          "SELECT status FROM invitation_delivery_attempts WHERE invitation_id=$1 AND completed_at IS NOT NULL",
          [created.id]
        )
      ).rows
    ).toEqual([{ status: "unknown" }])
    await page.reload()
    await expectUI(row).toContainText("邮件投递结果未知")
    await page
      .getByRole("button", { name: new RegExp(owner.user.name) })
      .click()
    await page.getByRole("menuitem", { name: "语言", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "English", exact: true })
      .press("Enter")
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    await expectUI(row).toContainText("Mail delivery result unknown")
    await page.keyboard.press("Escape")
    await expectUI(page.getByRole("menu")).toHaveCount(0)
    await page
      .getByRole("button", { name: new RegExp(owner.user.name) })
      .click()
    await page.getByRole("menuitem", { name: "Language", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "العربية", exact: true })
      .press("Enter")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expectUI(row).toContainText("نتيجة إرسال البريد غير معروفة")
    await page.keyboard.press("Escape")
    await expectUI(page.getByRole("menu")).toHaveCount(0)
    await page.screenshot({
      path: join(tmpdir(), "enterprise-admin-s8-invitation-unknown-ar.png"),
      animations: "disabled",
      fullPage: true,
    })
  } finally {
    await resources.disposeAsync()
  }
})
