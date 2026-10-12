import { randomBytes, randomUUID } from "node:crypto"
import { expect as expectUI } from "playwright/test"
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator, platformTotp } from "../setup/platform-operator.mjs"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"

async function attach(context, cookie, origin) {
  await context.addCookies(
    cookie.split("; ").map((part) => {
      const separator = part.indexOf("=")
      return {
        name: part.slice(0, separator),
        value: part.slice(separator + 1),
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      }
    })
  )
}

describe("账户安全原生认证与双后台浏览器", () => {
  let environment
  let contexts = []
  const clientIp = () => `10.${[...randomBytes(3)].join(".")}`
  beforeAll(async () => {
    environment = await startBrowserApplication({ mail: true })
  })
  afterEach(async () => {
    await Promise.all(contexts.map((context) => context.close()))
    contexts = []
  })
  afterAll(async () => {
    await environment?.close()
  })
  async function prepare(surface) {
    const origin =
      surface === "tenant"
        ? environment.tenantOrigin
        : environment.platformOrigin
    const account =
      surface === "tenant"
        ? await signUpVerified(
            environment.baseURL,
            origin,
            environment.migrator
          )
        : await platformOperator(environment, origin)
    const context = await environment.browser.newContext({
      userAgent: "Security current browser",
      extraHTTPHeaders: { "x-real-ip": clientIp() },
    })
    contexts.push(context)
    await attach(context, account.cookie, origin)
    const page = await context.newPage()
    const path =
      surface === "tenant"
        ? "/app/settings/preferences"
        : "/platform/personal-settings"
    await page.goto(origin + path)
    await expectUI(page.getByLabel("当前密码")).toBeVisible()
    return { context, page, origin, account, path }
  }
  async function anotherBrowser(target, label) {
    const context = await environment.browser.newContext({
      userAgent: label,
      extraHTTPHeaders: { "x-real-ip": clientIp() },
    })
    contexts.push(context)
    const response = await context.request.post(
      `${target.origin}/api/auth/sign-in/email`,
      {
        headers: { origin: target.origin },
        data: {
          email: target.account.email,
          password: target.account.password,
        },
      }
    )
    expect(response.status()).toBe(200)
    if (target.account.secret) {
      const verified = await context.request.post(
        `${target.origin}/api/auth/two-factor/verify-totp`,
        {
          headers: { origin: target.origin },
          data: { code: platformTotp(target.account.secret) },
        }
      )
      expect(verified.status()).toBe(200)
    }
    return context
  }
  for (const surface of ["tenant", "platform"]) {
    it(`${surface} 撤销所选会话并在密码变更后保留当前浏览器、撤销其他会话`, async () => {
      const target = await prepare(surface)
      const other = await anotherBrowser(target, "Security other browser")
      await target.page.reload()
      const sessions = target.page.getByRole("region", { name: "活跃会话" })
      const row = sessions
        .getByRole("listitem")
        .filter({ hasText: "Security other browser" })
      const beforeOther = await (
        await other.request.get(
          `${target.origin}/api/auth/get-session?disableCookieCache=true`
        )
      ).json()
      const revokeRequest = target.page.waitForRequest(
        (request) =>
          request.url().endsWith("/api/auth/revoke-session") &&
          request.method() === "POST"
      )
      await row.getByRole("button", { name: "退出会话" }).click()
      await target.page
        .getByRole("alertdialog")
        .getByRole("button", { name: "退出", exact: true })
        .click()
      const nativeRequest = await revokeRequest
      expect(
        nativeRequest.postDataJSON().token === beforeOther.session.token
      ).toBe(true)
      await expectUI(
        target.page.getByText("会话已退出。", { exact: true })
      ).toBeVisible()
      await expectUI(target.page.getByRole("alertdialog")).toHaveCount(0)
      await expectUI(row).toHaveCount(0)
      const protectedRead = await other.request.get(
        `${target.origin}/api/v1/me/preferences`
      )
      expect(protectedRead.status()).toBe(401)
      const third = await anotherBrowser(
        target,
        "Security password-revoked browser"
      )
      await target.page.reload()
      await target.page.getByLabel("当前密码").fill("Incorrect-password-123")
      const replacement = randomBytes(24).toString("hex")
      await target.page.getByLabel("新密码", { exact: true }).fill(replacement)
      await target.page.getByLabel("确认新密码").fill(replacement)
      await target.page
        .getByRole("button", { name: "修改密码", exact: true })
        .click()
      await expectUI(target.page.getByLabel("当前密码")).toHaveValue(
        "Incorrect-password-123"
      )
      await expectUI(
        target.page
          .getByRole("region", { name: "密码", exact: true })
          .getByRole("alert")
      ).toBeVisible()
      await target.page.getByLabel("当前密码").fill(target.account.password)
      await target.page
        .getByRole("button", { name: "修改密码", exact: true })
        .click()
      if (surface === "platform") {
        await expectUI(target.page).toHaveURL(/\/platform\/mfa/)
        await target.page
          .getByLabel("6 位验证码", { exact: true })
          .fill(platformTotp(target.account.secret))
        await target.page
          .getByRole("button", { name: "验证并继续", exact: true })
          .click()
        await target.page.goto(target.origin + target.path)
      } else {
        await expectUI(
          target.page.getByText("密码已修改，其他会话已退出。")
        ).toBeVisible()
      }
      const current = await target.context.request.get(
        `${target.origin}/api/auth/get-session?disableCookieCache=true`
      )
      expect((await current.json())?.user.id).toBe(target.account.user.id)
      const signedOut = await third.request.get(
        `${target.origin}/api/auth/get-session?disableCookieCache=true`
      )
      expect((await signedOut.json())?.user).toBeUndefined()
      const login = await environment.browser.newContext({
        extraHTTPHeaders: { "x-real-ip": clientIp() },
      })
      contexts.push(login)
      const signedIn = await login.request.post(
        `${target.origin}/api/auth/sign-in/email`,
        {
          headers: { origin: target.origin },
          data: { email: target.account.email, password: replacement },
        }
      )
      expect(signedIn.status()).toBe(200)
    })
    it(`${surface} 从会话列表退出当前浏览器后重新进入登录`, async () => {
      const target = await prepare(surface)
      const current = target.page
        .getByRole("region", { name: "活跃会话" })
        .getByRole("listitem")
        .filter({ hasText: "当前浏览器" })
      await current.getByRole("button", { name: "退出会话" }).click()
      await target.page
        .getByRole("alertdialog")
        .getByRole("button", { name: "退出", exact: true })
        .click()
      await expectUI(target.page).toHaveURL(/\/login$/)
      const protectedRead = await target.context.request.get(
        `${target.origin}/api/v1/me/preferences`
      )
      expect(protectedRead.status()).toBe(401)
    })
    it(`${surface} 新邮箱经SMTP原生验证后更新，用户ID保持不变`, async () => {
      const target = await prepare(surface)
      const newEmail = `${randomUUID()}@example.test`
      await target.page.getByLabel("新邮箱地址").fill(newEmail)
      await target.page
        .getByRole("button", { name: "修改邮箱", exact: true })
        .click()
      await expectUI(
        target.page
          .getByRole("region", { name: "邮箱地址", exact: true })
          .getByRole("status")
      ).toContainText(newEmail)
      const before = await target.context.request.get(
        `${target.origin}/api/auth/get-session?disableCookieCache=true`
      )
      const beforeUser = (await before.json()).user
      expect(beforeUser.id).toBe(target.account.user.id)
      expect(beforeUser.email).toBe(target.account.email)
      const mail = await waitForMail(
        environment.mailpitOrigin,
        newEmail,
        "验证你的邮箱"
      )
      await target.page.goto(firstHttpUrl(mail.HTML))
      await expectUI(target.page).toHaveURL(/\/auth\/verified/)
      const after = await target.context.request.get(
        `${target.origin}/api/auth/get-session?disableCookieCache=true`
      )
      const user = (await after.json()).user
      expect(user.id).toBe(target.account.user.id)
      expect(user.email).toBe(newEmail)
      expect(user.emailVerified).toBe(true)
      await target.page.goto(target.origin + target.path)
      await expectUI(
        target.page
          .getByRole("region", { name: "邮箱地址", exact: true })
          .getByText(newEmail)
      ).toBeVisible()
    })
  }
})
