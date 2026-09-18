import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { expect as expectUI } from "playwright/test"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"

function newAccount(name) {
  return {
    name,
    email: `${randomUUID()}@example.test`,
    password: randomBytes(24).toString("hex"),
  }
}

describe("email auth UI", () => {
  let environment
  let browser
  let context
  let page
  let pageErrors
  let tenantOrigin
  let platformOrigin
  let mailpitOrigin

  async function signUp(target, account) {
    await target.getByRole("button", { name: "创建账号", exact: true }).click()
    await target.getByLabel("姓名", { exact: true }).fill(account.name)
    await target.getByLabel("邮箱", { exact: true }).fill(account.email)
    await target.getByLabel("密码", { exact: true }).fill(account.password)
    await target.getByRole("button", { name: "注册", exact: true }).click()
    await expectUI(
      target.getByRole("heading", { name: "查收邮件", exact: true })
    ).toBeVisible()
  }

  async function signIn(target, account) {
    await target.getByLabel("邮箱", { exact: true }).fill(account.email)
    await target.getByLabel("密码", { exact: true }).fill(account.password)
    await target.getByRole("button", { name: "登录", exact: true }).click()
  }

  async function openMailLink(target, email, subject) {
    const message = await waitForMail(mailpitOrigin, email, subject)
    await target.goto(firstHttpUrl(message.HTML))
  }

  async function registerVerified(target, account) {
    await target.goto(`${tenantOrigin}/login`)
    await signUp(target, account)
    await openMailLink(target, account.email, "验证你的邮箱")
    await expectUI(
      target.getByRole("heading", { name: "邮箱已验证", exact: true })
    ).toBeVisible()
    // Base UI Button + Link 会设 role=button，不是 link。
    await target.getByRole("button", { name: "去登录", exact: true }).click()
    await signIn(target, account)
    await expectUI(target.getByLabel("组织名称", { exact: true })).toBeVisible()
  }

  beforeAll(async () => {
    environment = await startBrowserApplication({ mail: true })
    ;({ browser, tenantOrigin, platformOrigin, mailpitOrigin } = environment)
  })

  beforeEach(async () => {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    page = await context.newPage()
    pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await context.tracing.start({ screenshots: true, snapshots: true })
    await mkdir("test-results/email-ui", { recursive: true })
  })

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === "fail" || pageErrors.length) {
        await page.screenshot({
          path: `test-results/email-ui/${task.id}.png`,
          fullPage: true,
        })
        await context.tracing.stop({
          path: `test-results/email-ui/${task.id}.zip`,
        })
      } else {
        await context.tracing.stop()
      }
      expect(pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })

  afterAll(async () => {
    await environment?.close()
  })

  it("注册后未验证邮箱不能登录", async () => {
    const account = newAccount("未验证用户")
    await page.goto(`${tenantOrigin}/login`)
    await signUp(page, account)
    await page.getByRole("button", { name: "去登录", exact: true }).click()
    await signIn(page, account)
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: "登录", exact: true })
    ).toBeVisible()
  }, 120_000)

  it("注册后点验证邮件才能登录", async () => {
    const account = newAccount("验证用户")
    await page.goto(`${tenantOrigin}/login`)
    await signUp(page, account)
    await openMailLink(page, account.email, "验证你的邮箱")
    await expectUI(
      page.getByRole("heading", { name: "邮箱已验证", exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "去登录", exact: true }).click()
    await signIn(page, account)
    await expectUI(page.getByLabel("组织名称", { exact: true })).toBeVisible()
  }, 120_000)

  it("忘记密码走邮件链接后用新密码登录", async () => {
    const account = newAccount("重置用户")
    const nextPassword = randomBytes(24).toString("hex")
    await registerVerified(page, account)
    await page.getByRole("button", { name: "退出登录", exact: true }).click()
    await page.getByRole("link", { name: "忘记密码？", exact: true }).click()
    await page.getByLabel("邮箱", { exact: true }).fill(account.email)
    await page
      .getByRole("button", { name: "发送重置链接", exact: true })
      .click()
    await expectUI(
      page.getByText("如果该邮箱已注册，你将收到重置链接。", { exact: true })
    ).toBeVisible()
    await openMailLink(page, account.email, "重置你的密码")
    await expectUI(
      page.getByRole("heading", { name: "设置新密码", exact: true })
    ).toBeVisible()
    await page.getByLabel("新密码", { exact: true }).fill(nextPassword)
    await page.getByLabel("确认密码", { exact: true }).fill(nextPassword)
    await page.getByRole("button", { name: "设置新密码", exact: true }).click()
    await expectUI(
      page.getByText("密码已重置，请使用新密码登录。", { exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "去登录", exact: true }).click()
    await signIn(page, { ...account, password: nextPassword })
    await expectUI(page.getByLabel("组织名称", { exact: true })).toBeVisible()
  }, 120_000)

  it("成员页发出邀请后受邀人验证并接受", async () => {
    const owner = newAccount("邀请人")
    const invitee = newAccount("受邀人")
    const organization = {
      name: "邮件邀请组织",
      slug: `mail-invite-${randomUUID().slice(0, 8)}`,
    }
    await registerVerified(page, owner)
    await page.getByLabel("组织名称", { exact: true }).fill(organization.name)
    await page.getByLabel("组织标识", { exact: true }).fill(organization.slug)
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await page.getByRole("link", { name: "成员", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "成员", exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "邀请成员", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("邮箱", { exact: true }).fill(invitee.email)
    await dialog.getByRole("button", { name: "发送邀请", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(page.getByText(invitee.email, { exact: true })).toBeVisible()
    const invitation = await waitForMail(
      mailpitOrigin,
      invitee.email,
      `你收到一个组织邀请：${organization.name}`
    )
    const acceptUrl = firstHttpUrl(invitation.HTML)
    const accept = new URL(acceptUrl)
    expect(accept.origin).toBe(tenantOrigin)
    expect(accept.pathname.startsWith("/accept-invitation/")).toBe(true)

    const inviteeContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    const inviteePage = await inviteeContext.newPage()
    try {
      await registerVerified(inviteePage, invitee)
      await inviteePage.goto(acceptUrl)
      await expectUI(
        inviteePage.getByText(`加入 ${organization.name}。`, { exact: false })
      ).toBeVisible()
      await inviteePage
        .getByRole("button", { name: "接受邀请", exact: true })
        .click()
      await expectUI(inviteePage).toHaveURL(/\/app(?:\/|$)/)
    } finally {
      await inviteeContext.close()
    }
  }, 180_000)

  it("无效重置、验证和邀请落地页", async () => {
    await page.goto(`${tenantOrigin}/reset-password`)
    await expectUI(
      page.getByText("重置链接无效或已过期。", { exact: true })
    ).toBeVisible()
    await page.goto(`${tenantOrigin}/auth/verified?error=INVALID_TOKEN`)
    await expectUI(
      page.getByRole("heading", {
        name: "验证链接无效或已过期。",
        exact: true,
      })
    ).toBeVisible()
    await page.goto(
      `${tenantOrigin}/accept-invitation/00000000-0000-0000-0000-000000000000`
    )
    await expectUI(
      page.getByText("请先登录接受邀请的邮箱账号。", { exact: true })
    ).toBeVisible()
  })

  it("平台忘记密码、重置和已验证页可打开", async () => {
    await page.goto(`${platformOrigin}/forgot-password`)
    await expectUI(
      page.getByRole("heading", { name: "重置密码", exact: true })
    ).toBeVisible()
    await page.goto(`${platformOrigin}/reset-password`)
    await expectUI(
      page.getByText("重置链接无效或已过期。", { exact: true })
    ).toBeVisible()
    await page.goto(`${platformOrigin}/auth/verified`)
    await expectUI(
      page.getByRole("heading", { name: "邮箱已验证", exact: true })
    ).toBeVisible()
    await page.goto(`${platformOrigin}/auth/verified?error=INVALID_TOKEN`)
    await expectUI(
      page.getByRole("heading", {
        name: "验证链接无效或已过期。",
        exact: true,
      })
    ).toBeVisible()
  })
})
