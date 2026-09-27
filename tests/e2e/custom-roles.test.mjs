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
})
