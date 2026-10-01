import { randomBytes, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
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
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { platformTotp } from "../setup/platform-operator.mjs"
import { startBrowserApplication } from "../setup/test-runtime.mjs"

const runCLI = promisify(execFile)

async function signIn(page, origin, account) {
  await page.goto(origin + "/login")
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
}

async function selectLocale(page, userName, locale) {
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  await page.getByRole("menuitem", { name: "语言", exact: true }).click()
  await page
    .getByRole("menuitemradio", { name: locale, exact: true })
    .press("Enter")
}

async function createProject(page, name) {
  await page.getByRole("button", { name: "创建项目", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("项目名称", { exact: true }).fill(name)
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click()
  await expectUI(dialog).toHaveCount(0)
  await expectUI(page.getByRole("link", { name, exact: true })).toBeVisible()
}

describe("S8 cross-feature browser acceptance", () => {
  let environment, context, page
  beforeAll(async () => {
    environment = await startBrowserApplication({ mail: true })
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

  it.each(["organization", "account"])(
    "a late initial %s response preserves a language explicitly selected in the visible workspace",
    async (scope) => {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "语言竞态所有者" }
      )
      const org =
        scope === "organization"
          ? await environment.runtime.auth.api.createOrganization({
              headers: owner.headers,
              body: { name: "语言时序组织", slug: randomUUID() },
            })
          : null
      const responsePath = org
        ? `/organizations/${org.id}/access`
        : "/me/preferences"
      const requested = Promise.withResolvers(),
        released = Promise.withResolvers()
      // 只延后真实 HTTP 响应，不替换服务端数据或授权结果；重现用户操作早于初始查询返回。
      await page.route(`**/api/v1${responsePath}`, async (route) => {
        const response = await route.fetch()
        requested.resolve()
        await released.promise
        await route.fulfill({ response })
      })
      try {
        await signIn(page, environment.tenantOrigin, owner)
        await requested.promise
        if (org) await selectLocale(page, owner.user.name, "العربية")
        else {
          await page.getByRole("button", { name: "语言", exact: true }).click()
          await page
            .getByRole("menuitemradio", { name: "العربية", exact: true })
            .press("Enter")
        }
        await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
        const returned = page.waitForResponse((response) =>
          response.url().endsWith(responsePath)
        )
        released.resolve()
        expect((await returned).status()).toBe(200)
        await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
        if (org)
          await expectUI(
            page.getByRole("heading", { name: "المشاريع", exact: true })
          ).toBeVisible()
        else
          await expectUI(
            page.getByLabel("اسم المؤسسة", { exact: true })
          ).toBeVisible()
        await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
        await page.keyboard.press("Escape")
        await expectUI(page.getByRole("menu")).toHaveCount(0)
        await page.screenshot({
          path: `/private/tmp/enterprise-admin-s8-manual-${scope}-ar.png`,
          animations: "disabled",
          fullPage: true,
        })
      } finally {
        released.resolve()
      }
    }
  )

  it("invites a new recipient, verifies their real email, accepts, changes and revokes a role, then removes access and releases role references", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "组合流程所有者" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "邀请组合验收组织", slug: randomUUID() },
    })
    const recipient = {
      name: "邮件验证受邀人",
      email: `recipient-${randomUUID()}@example.test`,
      password: randomBytes(24).toString("hex"),
    }
    await signIn(page, environment.tenantOrigin, owner)
    const permissionRateLimits = []
    page.on("response", (response) => {
      if (
        response.status() === 429 &&
        response.url().includes("/api/auth/organization/has-permission")
      )
        permissionRateLimits.push(response.status())
    })
    await createProject(page, "组合验收项目")
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await page.getByLabel("角色标识", { exact: true }).fill("acceptance-editor")
    await page
      .getByRole("checkbox", { name: "项目：查看", exact: true })
      .check()
    await page
      .getByRole("checkbox", { name: "项目：编辑", exact: true })
      .check()
    await page.getByRole("button", { name: "创建角色", exact: true }).click()
    await expectUI(
      page.getByText("acceptance-editor", { exact: true })
    ).toBeVisible()
    await page.getByRole("link", { name: "成员", exact: true }).click()
    await page.getByRole("button", { name: "邀请成员", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("邮箱", { exact: true }).fill(recipient.email)
    await dialog.getByRole("button", { name: "发送邀请", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    const invite = page
      .getByRole("list", { name: "邀请", exact: true })
      .getByRole("listitem")
      .filter({ hasText: recipient.email })
    await expectUI(invite).toContainText("待处理")
    const invitationMail = await waitForMail(
      environment.mailpitOrigin,
      recipient.email,
      `你收到一个组织邀请：${org.name}`
    )
    expect(invitationMail.HTML).toContain('lang="zh-CN"')
    const invitationURL = firstHttpUrl(invitationMail.HTML)
    const recipientContext = await environment.browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    const memberPage = await recipientContext.newPage()
    try {
      // 收件人从公开页面注册并访问真实验证链接；这里不以数据库直接置 verified 替代验证流程。
      await memberPage.goto(invitationURL)
      await memberPage
        .getByRole("button", { name: "登录", exact: true })
        .click()
      await memberPage
        .getByRole("button", { name: "创建账号", exact: true })
        .click()
      await memberPage.getByLabel("姓名", { exact: true }).fill(recipient.name)
      await memberPage.getByLabel("邮箱", { exact: true }).fill(recipient.email)
      await memberPage
        .getByLabel("密码", { exact: true })
        .fill(recipient.password)
      await memberPage
        .getByRole("button", { name: "注册", exact: true })
        .click()
      await expectUI(
        memberPage.getByRole("heading", { name: "查收邮件", exact: true })
      ).toBeVisible()
      const verificationMail = await waitForMail(
        environment.mailpitOrigin,
        recipient.email,
        "验证你的邮箱"
      )
      await memberPage.goto(firstHttpUrl(verificationMail.HTML))
      await expectUI(
        memberPage.getByRole("heading", { name: "邮箱已验证", exact: true })
      ).toBeVisible()
      await signIn(memberPage, environment.tenantOrigin, recipient)
      const session = await memberPage.request.get(
        `${environment.tenantOrigin}/api/auth/get-session`
      )
      expect((await session.json()).user.emailVerified).toBe(true)
      await memberPage.goto(invitationURL)
      await memberPage
        .getByRole("button", { name: "接受邀请", exact: true })
        .click()
      await expectUI(memberPage).toHaveURL(
        new RegExp(`/app/projects/${org.id}`)
      )
      await expectUI(
        memberPage.getByRole("link", { name: "组合验收项目", exact: true })
      ).toBeVisible()

      await page.reload()
      const memberRow = page
        .getByRole("list", { name: "成员", exact: true })
        .getByRole("listitem")
        .filter({ hasText: recipient.email })
      await memberRow
        .getByRole("button", { name: "更改角色", exact: true })
        .click()
      await dialog.getByLabel("角色", { exact: true }).click()
      await page
        .getByRole("option", { name: "acceptance-editor", exact: true })
        .click()
      await dialog.getByRole("button", { name: "保存", exact: true }).click()
      await expectUI(dialog).toHaveCount(0)
      await expectUI(memberRow).toContainText("acceptance-editor")

      await memberPage
        .getByRole("link", { name: "组合验收项目", exact: true })
        .click()
      await memberPage
        .getByRole("button", { name: "编辑项目", exact: true })
        .click()
      const edit = memberPage.getByRole("dialog")
      await edit.getByLabel("描述", { exact: true }).fill("邀请加入后编辑成功")
      await edit.getByRole("button", { name: "保存项目", exact: true }).click()
      await expectUI(edit).toHaveCount(0)
      await expectUI(
        memberPage.getByText("邀请加入后编辑成功", { exact: true })
      ).toBeVisible()
      const projectId = new URL(memberPage.url()).pathname.split("/").at(-1)
      const apiProjectURL = `${environment.tenantOrigin}/api/v1/organizations/${org.id}/projects/${projectId}`

      // 已打开的编辑草稿会跨越撤权时刻；下一次真实提交必须失败，不能只证明按钮被隐藏。
      await memberPage
        .getByRole("button", { name: "编辑项目", exact: true })
        .click()
      await edit.getByLabel("描述", { exact: true }).fill("撤权后不应保存")
      await page.getByRole("link", { name: "角色", exact: true }).click()
      const role = page
        .getByRole("listitem")
        .filter({ hasText: "acceptance-editor" })
      await expectUI(role).toContainText("成员：1；有效邀请：0")
      await role.getByRole("button", { name: "修改权限", exact: true }).click()
      await dialog
        .getByRole("checkbox", { name: "项目：编辑", exact: true })
        .uncheck()
      await dialog
        .getByRole("button", { name: "确认更新", exact: true })
        .click()
      await expectUI(dialog).toHaveCount(0)
      await role.getByRole("button", { name: "删除角色", exact: true }).click()
      const rejectedDeletion = page.waitForResponse(
        (response) => response.url().endsWith("/organization/delete-role"),
        { timeout: 5_000 }
      )
      await dialog
        .getByRole("button", { name: "确认删除", exact: true })
        .click()
      const deletion = await rejectedDeletion
      expect(deletion.status()).toBe(409)
      expect(await deletion.json()).toMatchObject({
        code: "ROLE_IN_USE",
        memberCount: 1,
        invitationCount: 0,
      })
      await expectUI(dialog).toBeVisible()
      await expectUI(dialog.getByRole("alert")).toHaveText(
        "该角色仍被 1 位成员和 0 个有效邀请引用，请先解除引用。"
      )
      await page.screenshot({
        path: "/private/tmp/enterprise-admin-s8-role-reference.png",
        animations: "disabled",
        fullPage: true,
      })
      await dialog.getByRole("button", { name: "取消", exact: true }).click()
      const deniedUpdate = memberPage.waitForResponse(
        (response) =>
          response.url() === apiProjectURL &&
          response.request().method() === "PATCH"
      )
      await edit.getByRole("button", { name: "保存项目", exact: true }).click()
      const denied = await deniedUpdate
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" })
      await expectUI(edit.getByRole("alert")).toBeVisible()
      const currentProject = await memberPage.request.get(apiProjectURL)
      expect(currentProject.status()).toBe(200)
      expect((await currentProject.json()).description).toBe(
        "邀请加入后编辑成功"
      )
      await memberPage.reload()
      await expectUI(
        memberPage.getByRole("button", { name: "编辑项目", exact: true })
      ).toHaveCount(0)

      await page.getByRole("link", { name: "成员", exact: true }).click()
      await memberRow
        .getByRole("button", { name: "移除成员", exact: true })
        .click()
      const removal = page.waitForResponse((response) =>
        response.url().endsWith("/organization/remove-member")
      )
      await dialog
        .getByRole("button", { name: "移除成员", exact: true })
        .click()
      expect((await removal).status()).toBe(200)
      await expectUI(dialog).toHaveCount(0)
      await expectUI(memberRow).toHaveCount(0)
      const deniedRead = await memberPage.request.get(apiProjectURL)
      expect(deniedRead.status()).toBe(403)
      await memberPage.reload()
      await expectUI(
        memberPage.getByRole("heading", { name: "组合验收项目", exact: true })
      ).toHaveCount(0)
      await expectUI(
        memberPage.getByText("邀请加入后编辑成功", { exact: true })
      ).toHaveCount(0)
      await page.getByRole("link", { name: "角色", exact: true }).click()
      await expectUI(role).toContainText("成员：0；有效邀请：0")
      await role.getByRole("button", { name: "删除角色", exact: true }).click()
      await dialog
        .getByRole("button", { name: "确认删除", exact: true })
        .click()
      await expectUI(dialog).toHaveCount(0)
      await expectUI(role).toHaveCount(0)
      expect(permissionRateLimits).toEqual([])
    } finally {
      await recipientContext.close()
    }
  }, 120_000)

  it("keeps two tabs scoped to their URLs despite the shared active organization and clears both after sign-out", async () => {
    const actor = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "双标签所有者" }
    )
    const createOrganization = (name) =>
      environment.runtime.auth.api.createOrganization({
        headers: actor.headers,
        body: { name, slug: randomUUID() },
      })
    const a = await createOrganization("双标签组织A")
    const b = await createOrganization("双标签组织B")
    await signIn(page, environment.tenantOrigin, actor)
    await page.goto(`${environment.tenantOrigin}/app/projects/${a.id}`)
    await createProject(page, "仅组织A可见的项目")
    const otherPage = await context.newPage()
    await otherPage.goto(`${environment.tenantOrigin}/app/projects/${b.id}`)
    await createProject(otherPage, "仅组织B可见的项目")
    const switchOrganization = async (current, next) => {
      await otherPage
        .getByRole("button", { name: new RegExp(current.name) })
        .click()
      await otherPage
        .getByRole("menuitem", { name: new RegExp(next.name) })
        .click()
      await expectUI(otherPage).toHaveURL(
        new RegExp(`/app/projects/${next.id}`)
      )
    }
    await switchOrganization(b, a)
    await switchOrganization(a, b)
    const active = await otherPage.request.get(
      `${environment.tenantOrigin}/api/auth/organization/get-full-organization`
    )
    expect(active.status()).toBe(200)
    expect((await active.json()).id).toBe(b.id)
    // Session 的 activeOrganization 已是 B，A 标签仍必须显式读写 URL 中的 A。
    await page.bringToFront()
    await page.reload()
    await expectUI(page).toHaveURL(new RegExp(`/app/projects/${a.id}`))
    await expectUI(
      page.getByRole("link", { name: "仅组织A可见的项目", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("link", { name: "仅组织B可见的项目", exact: true })
    ).toHaveCount(0)
    await createProject(page, "共享活动组织改变后的A写入")
    await otherPage.reload()
    await expectUI(
      otherPage.getByRole("link", { name: "仅组织B可见的项目", exact: true })
    ).toBeVisible()
    await expectUI(
      otherPage.getByRole("link", {
        name: "共享活动组织改变后的A写入",
        exact: true,
      })
    ).toHaveCount(0)
    const names = async (organization) => {
      const response = await page.request.get(
        `${environment.tenantOrigin}/api/v1/organizations/${organization.id}/projects`
      )
      expect(response.status()).toBe(200)
      return (await response.json()).items.map((item) => item.name).sort()
    }
    expect(await names(a)).toEqual(
      ["仅组织A可见的项目", "共享活动组织改变后的A写入"].sort()
    )
    expect(await names(b)).toEqual(["仅组织B可见的项目"])
    await otherPage
      .getByRole("link", { name: "仅组织B可见的项目", exact: true })
      .click()
    await expectUI(
      otherPage.getByRole("heading", { name: "仅组织B可见的项目", exact: true })
    ).toBeVisible()
    await otherPage
      .getByRole("button", { name: new RegExp(actor.user.name) })
      .click()
    await otherPage
      .getByRole("menuitem", { name: "退出登录", exact: true })
      .click()
    await expectUI(otherPage).toHaveURL(/\/login(?:\?|$)/)
    await otherPage.goBack()
    await expectUI(otherPage).toHaveURL(/\/login(?:\?|$)/)
    await expectUI(
      otherPage.getByRole("heading", { name: "仅组织B可见的项目", exact: true })
    ).toHaveCount(0)
    await page.bringToFront()
    await expectUI(page).toHaveURL(/\/login(?:\?|$)/)
    await expectUI(
      page.getByRole("link", { name: "仅组织A可见的项目", exact: true })
    ).toHaveCount(0)
    expect(
      (
        await page.request.get(
          `${environment.tenantOrigin}/api/v1/organizations/${a.id}/projects`
        )
      ).status()
    ).toBe(401)
  })

  it("shows a retryable read error instead of a permission denial when role permission loading is rate limited", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "权限读取异常组织", slug: randomUUID() },
    })
    await signIn(page, environment.tenantOrigin, owner)
    const route = `**/api/v1/organizations/${org.id}/role-access`
    await page.route(route, (request) =>
      request.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          code: "RATE_LIMITED",
          message: "Permission read throttled",
          requestId: randomUUID(),
        }),
      })
    )
    await page.getByRole("link", { name: "角色", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "加载失败", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: "无权访问", exact: true })
    ).toHaveCount(0)
    await page.unroute(route)
    await page.getByRole("button", { name: "重试", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "角色", exact: true })
    ).toBeVisible()
  })

  it("enrolls platform MFA in the real page, suspends tenant access, restores it and exposes only the tenant event projection", async () => {
    const owner = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "状态组合所有者" }
    )
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "MFA停用恢复组合组织", slug: randomUUID() },
    })
    await signIn(page, environment.tenantOrigin, owner)
    await createProject(page, "停用恢复后保留的项目")
    const admin = await signUpVerified(
      environment.baseURL,
      environment.platformOrigin,
      environment.migrator,
      { name: "状态组合平台管理员" }
    )
    await runCLI(
      process.execPath,
      [
        "apps/api/dist/console.js",
        "platform",
        "assignment",
        "grant",
        "--user-id",
        admin.user.id,
        "--role",
        "platform_admin",
        "--reason",
        "S8 combined browser acceptance",
      ],
      {
        env: {
          PATH: process.env.PATH,
          PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
        },
      }
    )
    const platformContext = await environment.browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    const platformPage = await platformContext.newPage()
    const internalReason = "仅平台内部使用的风控排查原因，不应向租户公开"
    try {
      await platformPage.goto(environment.platformOrigin + "/platform")
      await platformPage.getByLabel("邮箱", { exact: true }).fill(admin.email)
      await platformPage
        .getByLabel("密码", { exact: true })
        .fill(admin.password)
      await platformPage
        .getByRole("button", { name: "登录", exact: true })
        .click()
      await expectUI(
        platformPage.getByRole("heading", {
          name: "设置平台双重验证",
          exact: true,
        })
      ).toBeVisible()
      await expectUI(
        platformPage.getByRole("link", { name: "组织", exact: true })
      ).toHaveCount(0)
      await platformPage
        .getByLabel("密码", { exact: true })
        .fill(admin.password)
      await platformPage
        .getByRole("button", { name: "生成 TOTP 密钥", exact: true })
        .click()
      const uri = platformPage.getByLabel("身份验证器配置 URI", { exact: true })
      await expectUI(uri).toBeVisible()
      const secret = new URL(await uri.inputValue()).searchParams.get("secret")
      await platformPage
        .getByLabel("6 位验证码", { exact: true })
        .fill(platformTotp(secret))
      await platformPage
        .getByRole("button", { name: "验证并继续", exact: true })
        .click()
      await expectUI(
        platformPage.getByText("平台管理员 · 全平台范围", { exact: true })
      ).toBeVisible()
      await platformPage
        .getByRole("link", { name: "组织", exact: true })
        .last()
        .click()
      await platformPage
        .getByRole("link", { name: org.name, exact: true })
        .click()
      await platformPage
        .getByRole("button", { name: "停用组织", exact: true })
        .click()
      const confirm = platformPage.getByRole("alertdialog")
      await confirm.getByLabel("原因", { exact: true }).fill(internalReason)
      await confirm.getByLabel("组织 slug", { exact: true }).fill(org.slug)
      await confirm
        .getByRole("button", { name: "确认停用", exact: true })
        .click()
      await expectUI(confirm).toHaveCount(0)
      await expectUI(
        platformPage.getByRole("status").filter({ hasText: "组织已停用。" })
      ).toBeVisible()
      const projectsURL = `${environment.tenantOrigin}/api/v1/organizations/${org.id}/projects`
      const rejected = await page.request.get(projectsURL)
      expect(rejected.status()).toBe(403)
      expect(await rejected.json()).toMatchObject({
        code: "ORGANIZATION_SUSPENDED",
      })
      await page.reload()
      await expectUI(
        page.getByRole("alert").filter({ hasText: "该组织已停用" })
      ).toBeVisible()
      await expectUI(
        page.getByRole("link", { name: "停用恢复后保留的项目", exact: true })
      ).toHaveCount(0)
      await platformPage
        .getByRole("button", { name: "恢复组织", exact: true })
        .click()
      await confirm
        .getByLabel("原因", { exact: true })
        .fill("组合验收完成后恢复组织的正常访问")
      await confirm.getByLabel("组织 slug", { exact: true }).fill(org.slug)
      await confirm
        .getByRole("button", { name: "确认恢复", exact: true })
        .click()
      await expectUI(confirm).toHaveCount(0)
      await expectUI(
        platformPage.getByRole("status").filter({ hasText: "组织已恢复。" })
      ).toBeVisible()
      expect((await page.request.get(projectsURL)).status()).toBe(200)
      await page.reload()
      await expectUI(
        page.getByRole("link", { name: "停用恢复后保留的项目", exact: true })
      ).toBeVisible()
      await page.getByRole("link", { name: "审计", exact: true }).click()
      await expectUI(
        page.getByRole("button", { name: "平台停用组织", exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "平台恢复组织", exact: true })
      ).toBeVisible()
      const response = await page.request.get(
        `${environment.tenantOrigin}/api/v1/organizations/${org.id}/audit-events`
      )
      expect(response.status()).toBe(200)
      const audit = await response.json()
      expect(
        audit.items
          .filter((event) =>
            event.eventCode.startsWith("platform.organization_")
          )
          .map((event) => event.eventCode)
          .sort()
      ).toEqual([
        "platform.organization_resumed",
        "platform.organization_suspended",
      ])
      expect(JSON.stringify(audit)).not.toContain(internalReason)
      const suspendedEvent = audit.items.find(
        (event) => event.eventCode === "platform.organization_suspended"
      )
      const detailResponse = page.waitForResponse((response) =>
        response.url().endsWith(`/audit-events/${suspendedEvent.id}`)
      )
      await page
        .getByRole("button", { name: "平台停用组织", exact: true })
        .click()
      const detail = await detailResponse
      expect(detail.status()).toBe(200)
      const event = await detail.json()
      expect(event).toMatchObject({
        id: suspendedEvent.id,
        eventCode: "platform.organization_suspended",
        scope: "platform",
      })
      expect(JSON.stringify(event)).not.toContain(internalReason)
      const detailDialog = page.getByRole("dialog")
      await expectUI(
        detailDialog.getByRole("heading", { name: "平台停用组织", exact: true })
      ).toBeVisible()
      await expectUI(detailDialog.getByRole("status")).toHaveCount(0)
      expect(await detailDialog.innerText()).not.toContain(internalReason)
      await page.screenshot({
        path: "/private/tmp/enterprise-admin-s8-tenant-platform-projection.png",
        animations: "disabled",
        fullPage: true,
      })
    } finally {
      await platformContext.close()
    }
  }, 120_000)
})
