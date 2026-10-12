import { randomBytes, randomUUID } from "node:crypto"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("组织调用凭据浏览器流程", () => {
  let environment
  beforeAll(async () => {
    environment = await startBrowserApplication()
  })
  afterAll(async () => environment?.close())
  it("创建一次性密钥，通过 scope 调用项目后撤销并拒绝后续请求", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "凭据管理员" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "凭据验收组织", slug: randomUUID() },
    })
    const context = await environment.browser.newContext({
      viewport: { width: 1280, height: 800 },
      permissions: ["clipboard-read", "clipboard-write"],
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    try {
      const page = await context.newPage()
      await page.goto(`${environment.tenantOrigin}/login`)
      await page.getByLabel("邮箱", { exact: true }).fill(owner.email)
      await page.getByLabel("密码", { exact: true }).fill(owner.password)
      await page.getByRole("button", { name: "登录", exact: true }).click()
      await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
      await page.goto(`${environment.tenantOrigin}/app/integrations/${org.id}`)
      await expectUI(
        page.getByRole("heading", { name: "调用凭据", exact: true })
      ).toBeVisible()
      await page.getByRole("button", { name: "创建凭据", exact: true }).click()
      const form = page.getByRole("dialog")
      await form.getByLabel("名称", { exact: true }).fill("财务系统")
      const expiry = new Date(Date.now() + 86_400_000)
      expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset())
      await form
        .getByLabel("到期时间", { exact: true })
        .fill(expiry.toISOString().slice(0, 16))
      await form
        .getByRole("checkbox", { name: "项目：读取", exact: true })
        .check()
      const issuedResponse = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/organizations/${org.id}/access-credentials`) &&
          response.request().method() === "POST"
      )
      await form.getByRole("button", { name: "创建凭据", exact: true }).click()
      expect((await issuedResponse).status()).toBe(201)
      const keyInput = page.getByRole("textbox", { name: "密钥", exact: true })
      await expectUI(keyInput).toBeVisible()
      const key = await keyInput.inputValue()
      expect(key.startsWith("ea_")).toBe(true)
      await page.getByRole("button", { name: "复制密钥", exact: true }).click()
      await expectUI(page.getByRole("status")).toContainText("密钥已复制")
      expect(
        (await page.evaluate(() => navigator.clipboard.readText())) === key
      ).toBe(true)
      const read = await fetch(
        `${environment.baseURL}/api/v1/organizations/${org.id}/projects`,
        { headers: { "x-api-key": key } }
      )
      expect(read.status).toBe(200)
      const preferences = await fetch(
        `${environment.baseURL}/api/v1/me/preferences`,
        { headers: { "x-api-key": key } }
      )
      expect(preferences.status).toBe(401)
      await page.getByRole("button", { name: "关闭", exact: true }).click()
      await expectUI(keyInput).toHaveCount(0)
      expect(
        await page.evaluate(
          (secret) =>
            Object.values(localStorage)
              .concat(Object.values(sessionStorage))
              .some((value) => value.includes(secret)),
          key
        )
      ).toBe(false)
      await page.reload()
      await expectUI(page.getByText("财务系统", { exact: true })).toBeVisible()
      await expectUI(keyInput).toHaveCount(0)
      const metadata = await fetch(
        `${environment.baseURL}/api/v1/organizations/${org.id}/access-credentials`,
        { headers: { cookie: owner.cookie } }
      )
      expect(metadata.status).toBe(200)
      const result = await metadata.json()
      expect(result.items.some((item) => Object.hasOwn(item, "key"))).toBe(
        false
      )
      await page.getByRole("button", { name: "撤销", exact: true }).click()
      const confirmation = page.getByRole("alertdialog")
      const revokedResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "DELETE" &&
          response.url().includes("/access-credentials/")
      )
      await confirmation
        .getByRole("button", { name: "撤销", exact: true })
        .click()
      expect((await revokedResponse).status()).toBe(204)
      await expectUI(confirmation).toHaveCount(0)
      await expectUI(page.getByText("已撤销", { exact: true })).toBeVisible()
      const rejected = await fetch(
        `${environment.baseURL}/api/v1/organizations/${org.id}/projects`,
        { headers: { "x-api-key": key } }
      )
      expect(rejected.status).toBe(401)
    } finally {
      await context.close()
    }
  })
})
