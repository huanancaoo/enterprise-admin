import { randomBytes, randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { startPersonalAvatarBrowser } from "../setup/personal-avatar-runtime.mjs"

describe("页面组织结构：真实 API 导航与授权", () => {
  const resources = new AsyncDisposableStack()
  let environment
  const contexts = []

  beforeAll(async () => {
    try {
      // 文件页入口需要真实存储服务；复用现有的双后台与 RustFS 浏览器夹具。
      environment = await startPersonalAvatarBrowser("RustFS", resources)
    } catch (error) {
      await resources.disposeAsync()
      throw error
    }
  })
  afterEach(async () => {
    for (const context of contexts.splice(0)) await context.close()
  })
  afterAll(() => resources.disposeAsync())

  const account = (name) =>
    signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name }
    )
  const organization = (owner, name) =>
    environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name, slug: `navigation-${randomUUID()}` },
    })
  async function pageFor(actor, origin = environment.tenantOrigin) {
    const context = await environment.browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    contexts.push(context)
    await context.addCookies(
      actor.cookie.split("; ").map((part) => {
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
    return context.newPage()
  }
  const main = (page) =>
    page.getByRole("navigation", { name: "主导航", exact: true })
  const management = (page) =>
    page.getByRole("navigation", { name: "组织管理", exact: true })
  async function switchOrganization(page, current, next) {
    await page.getByRole("button", { name: new RegExp(current.name) }).click()
    await page.getByRole("menuitem", { name: new RegExp(next.name) }).click()
    await expectUI(page.getByRole("menu", { includeHidden: true })).toHaveCount(
      0
    )
  }

  it("租户保留三个主入口，管理分区深链刷新和切组织保留分区，文件工具绑定当前组织", async () => {
    const owner = await account("导航组织所有者")
    const north = await organization(owner, "导航北组织")
    const south = await organization(owner, "导航南组织")
    for (const [org, role] of [
      [north, "navigation-north"],
      [south, "navigation-south"],
    ]) {
      await environment.runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: {
          organizationId: org.id,
          role,
          permission: { project: ["read"] },
        },
      })
    }
    const page = await pageFor(owner)
    await page.goto(
      `${environment.tenantOrigin}/app/organizations/${north.id}/roles`
    )
    await expectUI(
      management(page).getByRole("link", { name: "角色权限", exact: true })
    ).toHaveAttribute("aria-current", "page")
    expect(await main(page).getByRole("link").allTextContents()).toEqual([
      "项目",
      "文件",
      "组织管理",
    ])
    await expectUI(
      page.getByText("navigation-north", { exact: true })
    ).toBeVisible()
    await page.reload()
    await expectUI(
      management(page).getByRole("link", { name: "角色权限", exact: true })
    ).toHaveAttribute("aria-current", "page")
    await switchOrganization(page, north, south)
    await expectUI(page).toHaveURL(
      new RegExp(`/app/organizations/${south.id}/roles$`)
    )
    await expectUI(
      page.getByText("navigation-south", { exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByText("navigation-north", { exact: true })
    ).toHaveCount(0)
    for (const link of await management(page).getByRole("link").all()) {
      expect(await link.getAttribute("href")).toContain(south.id)
    }
    await page.screenshot({
      path: join(tmpdir(), "enterprise-navigation-organization-switch.png"),
    })

    await management(page)
      .getByRole("link", { name: "常规设置", exact: true })
      .click()
    await expectUI(
      page.getByRole("heading", { name: "组织语言设置", exact: true })
    ).toBeVisible()
    await switchOrganization(page, south, north)
    await expectUI(page).toHaveURL(
      new RegExp(`/app/organizations/${north.id}/settings$`)
    )
    await expectUI(
      management(page).getByRole("link", { name: "常规设置", exact: true })
    ).toHaveAttribute("aria-current", "page")

    for (const [label, path] of [
      ["任务中心", "tasks"],
      ["通知", "notifications"],
    ]) {
      await main(page).getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(
        page.getByRole("heading", { name: "文件", exact: true })
      ).toBeVisible()
      await page
        .getByRole("navigation", { name: "任务中心 · 通知", exact: true })
        .getByRole("link", { name: label, exact: true })
        .click()
      await expectUI(page).toHaveURL(
        new RegExp(`/app/${path}/${north.id}(?:\\?|$)`)
      )
      await expectUI(
        page.getByRole("heading", { name: label, exact: true })
      ).toBeVisible()
    }
  })

  it("成员可读成员与角色目录，但角色写入、常规设置和其他组织仍由真实权限拒绝", async () => {
    const owner = await account("权限边界所有者")
    const member = await account("权限边界成员")
    const allowed = await organization(owner, "允许成员查看的组织")
    const foreign = await organization(owner, "未加入的组织")
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: allowed.id,
        userId: member.user.id,
        role: "member",
      },
    })
    await environment.runtime.auth.api.createOrgRole({
      headers: owner.headers,
      body: {
        organizationId: allowed.id,
        role: "navigation-member-readable",
        permission: { project: ["read"] },
      },
    })
    const page = await pageFor(member)
    await page.goto(`${environment.tenantOrigin}/app/members/${allowed.id}`)
    await expectUI(
      page.getByRole("list", { name: "成员", exact: true })
    ).toBeVisible()
    await expectUI(
      management(page).getByRole("link", { name: "常规设置", exact: true })
    ).toHaveCount(0)
    await management(page)
      .getByRole("link", { name: "角色权限", exact: true })
      .click()
    // 内置成员拥有角色目录只读权限，入口重组不能改变这项授权。
    await expectUI(
      page.getByText("navigation-member-readable", { exact: true })
    ).toBeVisible()
    await expectUI(page.getByLabel("角色标识", { exact: true })).toHaveCount(0)
    for (const label of ["修改权限", "删除角色"]) {
      await expectUI(
        page.getByRole("button", { name: label, exact: true })
      ).toHaveCount(0)
    }
    expect(
      (
        await page.request.post(
          `${environment.tenantOrigin}/api/auth/organization/create-role`,
          {
            headers: { origin: environment.tenantOrigin },
            data: {
              organizationId: allowed.id,
              role: "navigation-member-forbidden",
              permission: { project: ["read"] },
            },
          }
        )
      ).status()
    ).toBe(403)

    await page.goto(
      `${environment.tenantOrigin}/app/organizations/${allowed.id}/settings`
    )
    await expectUI(
      page.getByText("你没有查看或修改组织语言设置的权限。", { exact: true })
    ).toBeVisible()
    expect(
      (
        await page.request.get(
          `${environment.tenantOrigin}/api/v1/organizations/${allowed.id}/settings`
        )
      ).status()
    ).toBe(403)
    expect(
      (
        await page.request.get(
          `${environment.tenantOrigin}/api/v1/organizations/${foreign.id}/access`
        )
      ).status()
    ).toBe(403)
    await page.goto(`${environment.tenantOrigin}/app/members/${foreign.id}`)
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByRole("list", { name: "成员", exact: true })
    ).toHaveCount(0)
  })

  it("两种平台角色都有四项导航和头像设置入口，审计员写入及普通账号的平台访问仍被拒绝", async () => {
    for (const role of ["platform_admin", "platform_auditor"]) {
      const actor = await platformOperator(
        environment,
        environment.platformOrigin,
        role
      )
      const page = await pageFor(actor, environment.platformOrigin)
      await page.goto(`${environment.platformOrigin}/platform`)
      await expectUI(page).toHaveURL(/\/platform\/organizations(?:\?|$)/)
      await expectUI(
        page.getByRole("heading", { name: "组织", exact: true })
      ).toBeVisible()
      expect(await main(page).getByRole("link").allTextContents()).toEqual([
        "组织",
        "用户",
        "审计",
        "平台设置",
      ])
      await page.screenshot({
        path: join(tmpdir(), `enterprise-navigation-${role}.png`),
      })
      for (const label of ["用户", "审计", "平台设置"]) {
        await main(page).getByRole("link", { name: label, exact: true }).click()
        await expectUI(
          page.getByRole("heading", { name: label, exact: true })
        ).toBeVisible()
      }
      if (role === "platform_auditor") {
        await expectUI(
          page.getByText("平台审计员可以查看这些设置。", { exact: true })
        ).toBeVisible()
        await expectUI(
          page.getByRole("button", { name: "保存", exact: true })
        ).toHaveCount(0)
        const setting = await (
          await page.request.get(
            `${environment.platformOrigin}/api/v1/platform/settings`
          )
        ).json()
        const denied = await page.request.patch(
          `${environment.platformOrigin}/api/v1/platform/settings`,
          {
            headers: {
              origin: environment.platformOrigin,
              "idempotency-key": randomUUID(),
            },
            data: {
              platformDefaultLocale: setting.platformDefaultLocale,
              expectedVersion: setting.version,
              reason: "验证平台审计员无权修改平台设置",
            },
          }
        )
        expect(denied.status()).toBe(403)
      }
      await page
        .locator('[data-slot="sidebar-footer"]')
        .getByRole("button")
        .click()
      await page
        .getByRole("menuitem", { name: "个人设置", exact: true })
        .click()
      await expectUI(page).toHaveURL(/\/platform\/personal-settings$/)
      await expectUI(
        page.getByRole("heading", { name: "个人设置", exact: true })
      ).toBeVisible()
    }
    const ordinary = await account("普通组织用户")
    const page = await pageFor(ordinary, environment.platformOrigin)
    await page.goto(`${environment.platformOrigin}/platform`)
    await expectUI(page).toHaveURL(/\/platform\/access-denied$/)
    await expectUI(main(page)).toHaveCount(0)
    expect(
      (
        await page.request.get(
          `${environment.platformOrigin}/api/v1/platform/organizations`
        )
      ).status()
    ).toBe(403)
  })
})
