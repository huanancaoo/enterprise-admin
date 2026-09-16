import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { chromium } from "playwright"
import { expect as expectUI } from "playwright/test"
import { GenericContainer, Wait } from "testcontainers"
import { createServer } from "vite"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { projectRepository } from "../../packages/database/dist/repositories/projects.js"
import { projects } from "../../packages/database/dist/schema/projects.js"

const require = createRequire(import.meta.url)
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")
const { RequestLanguage } = require("../../apps/api/dist/request-language.js")
const {
  TenantContextService,
} = require("../../apps/api/dist/tenant-context.service.js")

async function registerAccount(page, account) {
  await page.getByRole("button", { name: "创建账号", exact: true }).click()
  await page.getByLabel("姓名", { exact: true }).fill(account.name)
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "注册", exact: true }).click()
}

describe("S4-02：真实浏览器认证与组织流程", () => {
  let container
  let app
  let runtime
  let tenantContexts
  let browser
  let context
  let page
  let pageErrors
  const originalAdminApiProxyTarget = process.env.ADMIN_API_PROXY_TARGET
  const frontends = []
  const credentials = {
    email: "s4-02@example.test",
    password: randomBytes(24).toString("hex"),
  }

  beforeAll(async () => {
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    const passwords = Array.from({ length: 4 }, () =>
      randomBytes(24).toString("hex")
    )
    container = await new GenericContainer(versions.postgresql.image)
      .withEnvironment({
        POSTGRES_USER: "bootstrap_admin",
        POSTGRES_DB: "enterprise_admin",
        POSTGRES_PASSWORD: passwords[0],
        APP_MIGRATOR_PASSWORD: passwords[1],
        APP_RUNTIME_PASSWORD: passwords[2],
        PLATFORM_RUNTIME_PASSWORD: passwords[3],
      })
      .withCopyFilesToContainer([
        {
          source: resolve("infra/postgres/bootstrap.sql"),
          target: "/docker-entrypoint-initdb.d/001-bootstrap.sql",
        },
      ])
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage("database system is ready to accept connections", 2)
      )
      .start()
    const databaseURL = (user, password) =>
      `postgresql://${user}:${password}@${container.getHost()}:${container.getMappedPort(5432)}/enterprise_admin`
    await promisify(execFile)(
      process.execPath,
      ["packages/database/src/migrate.ts"],
      {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: databaseURL("app_migrator", passwords[1]),
        },
      }
    )
    app = await createApplication(
      {
        databaseURL: databaseURL("app_runtime", passwords[2]),
        baseURL: "http://127.0.0.1",
        secret: randomBytes(32).toString("hex"),
        // 测试前端由 OS 分配端口；仅此临时认证实例信任 loopback 的随机端口。
        trustedOrigins: ["http://127.0.0.1:*"],
      },
      { logger: false }
    )
    runtime = app.get(AuthRuntime)
    tenantContexts = app.get(TenantContextService)
    await app.listen(0, "127.0.0.1")
    const apiOrigin = await app.getUrl()
    process.env.ADMIN_API_PROXY_TARGET = apiOrigin
    for (const name of ["admin", "platform"]) {
      const server = await createServer({
        root: resolve(`apps/${name}`),
        configFile: resolve(`apps/${name}/vite.config.ts`),
        server: {
          host: "127.0.0.1",
          port: 0,
          ...(name === "platform" ? { proxy: { "/api/auth": apiOrigin } } : {}),
        },
      })
      frontends.push(server)
      await server.listen()
    }
    browser = await chromium.launch()
  })

  beforeEach(async () => {
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    })
    page = await context.newPage()
    pageErrors = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await context.tracing.start({ screenshots: true, snapshots: true })
    await mkdir("test-results/s4-02", { recursive: true })
  })

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === "fail" || pageErrors.length) {
        await page.screenshot({
          path: `test-results/s4-02/${task.id}.png`,
          fullPage: true,
        })
        await context.tracing.stop({
          path: `test-results/s4-02/${task.id}.zip`,
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
    try {
      await browser?.close()
    } finally {
      try {
        await Promise.all(frontends.map((server) => server.close()))
      } finally {
        try {
          await app?.close()
        } finally {
          if (originalAdminApiProxyTarget === undefined) {
            delete process.env.ADMIN_API_PROXY_TARGET
          } else {
            process.env.ADMIN_API_PROXY_TARGET = originalAdminApiProxyTarget
          }
          await container?.stop()
        }
      }
    }
  })

  async function seedProjectsOutsideFirstPage(headers, organizationId) {
    const tenant = await tenantContexts.resolve(
      headers,
      organizationId,
      { project: ["create"] },
      "e2e-project-list-seed",
      new RequestLanguage(null)
    )
    await createTenantRunner(runtime.pool)(tenant, async (tx) => {
      await projectRepository.create(tx, {
        name: "页外目标项目",
        description: null,
        contentLocale: "zh-CN",
      })
      // 此临时库尚无其他项目；将唯一目标固定为旧记录，才能证明搜索不是只查当前 20 行。
      await tx.update(projects).set({
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })
      for (let index = 1; index <= 25; index += 1) {
        await projectRepository.create(tx, {
          name: `填充项目 ${index}`,
          description: null,
          contentLocale: "zh-CN",
        })
      }
    })
  }

  it("切换语言保留 URL 和表单草稿，同步 HTML 方向", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "login")
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    const originalURL = page.url()
    await page
      .getByLabel("邮箱", { exact: true })
      .fill("locale-draft@example.test")
    await page.getByRole("button", { name: "语言" }).click()
    await page
      .getByRole("menuitemradio", { name: "English", exact: true })
      .click()
    await expectUI(
      page.getByRole("heading", { name: "Sign in", exact: true })
    ).toBeVisible()
    await expectUI(page.getByLabel("Email", { exact: true })).toHaveValue(
      "locale-draft@example.test"
    )
    expect(page.url()).toBe(originalURL)
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    await page.getByRole("button", { name: "Language" }).click()
    await page
      .getByRole("menuitemradio", { name: "العربية", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expectUI(
      page.getByLabel("البريد الإلكتروني", { exact: true })
    ).toHaveValue("locale-draft@example.test")
    expect(page.url()).toBe(originalURL)
    await mkdir("test-results/s6", { recursive: true })
    await page.screenshot({
      path: "test-results/s6/login-rtl.png",
      fullPage: true,
    })
    await page.getByRole("button", { name: "اللغة" }).click()
    await page
      .getByRole("menuitemradio", { name: "简体中文", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "ltr")
    expect(page.url()).toBe(originalURL)
  })

  describe("S7：项目列表", () => {
    it("通过内置搜索命中当前页外的真实组织数据，并可由 URL 恢复", async () => {
      await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
      await registerAccount(page, {
        name: "项目列表用户",
        email: "projects-list-browser@example.test",
        password: credentials.password,
      })
      await page.getByLabel("组织名称", { exact: true }).fill("项目列表组织")
      await page.getByLabel("组织标识", { exact: true }).fill("projects-list")
      await page.getByRole("button", { name: "创建组织", exact: true }).click()
      await expectUI(
        page.getByRole("heading", {
          name: "当前组织：项目列表组织",
          exact: true,
        })
      ).toBeVisible()
      await page.getByRole("link", { name: "查看项目", exact: true }).click()
      await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
      const organizationId = new URL(page.url()).pathname.split("/").at(-1)
      expect(organizationId).toBeTruthy()
      const cookie = (await context.cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join("; ")
      await seedProjectsOutsideFirstPage(
        new Headers({ cookie }),
        String(organizationId)
      )
      await page.reload()
      await expectUI(
        page.getByText("填充项目", { exact: false }).first()
      ).toBeVisible()
      await expectUI(
        page.getByText("页外目标项目", { exact: true })
      ).toHaveCount(0)
      const targetRequest = page.waitForRequest((request) => {
        const url = new URL(request.url())
        return (
          url.pathname === `/api/v1/organizations/${organizationId}/projects` &&
          url.searchParams.get("name") === "页外目标项目"
        )
      })
      await page
        .getByRole("textbox", { name: "搜索项目名称", exact: true })
        .fill("页外目标项目")
      await targetRequest
      await expectUI(
        page.getByText("页外目标项目", { exact: true })
      ).toBeVisible()
      const filteredURL = new URL(page.url())
      expect(filteredURL.searchParams.get("name")).toBe("页外目标项目")
      expect(filteredURL.searchParams.get("page")).toBe("1")
      expect(filteredURL.searchParams.get("pageSize")).toBe("20")
      await page.reload()
      await expectUI(
        page.getByText("页外目标项目", { exact: true })
      ).toBeVisible()
    })
  })

  it("正式创建失败保留草稿，切语言保留内容，成功列表读回且刷新持久化", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "项目创建用户",
      email: "project-create-browser@example.test",
      password: credentials.password,
    })
    await page.getByLabel("组织名称", { exact: true }).fill("项目创建组织")
    await page.getByLabel("组织标识", { exact: true }).fill("project-create")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await page.getByRole("link", { name: "查看项目", exact: true }).click()
    await page.getByRole("button", { name: "创建项目", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("项目名称", { exact: true }).fill("浏览器创建项目")
    await dialog.getByLabel("描述", { exact: true }).fill("真实持久化")
    await page.route("**/api/v1/organizations/*/projects", async (route) => {
      if (route.request().method() === "POST") await route.abort()
      else await route.continue()
    })
    await dialog.getByRole("button", { name: "创建项目", exact: true }).click()
    await expectUI(dialog.getByRole("alert")).toBeVisible()
    await expectUI(dialog.getByLabel("项目名称", { exact: true })).toHaveValue(
      "浏览器创建项目"
    )
    await page.unroute("**/api/v1/organizations/*/projects")
    await page.keyboard.press("Escape")
    const originalURL = page.url()
    await page.getByRole("button", { name: "语言", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "English", exact: true })
      .click()
    expect(page.url()).toBe(originalURL)
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click()
    await expectUI(
      dialog.getByLabel("Project name", { exact: true })
    ).toHaveValue("浏览器创建项目")
    await expectUI(
      dialog.getByLabel("Description", { exact: true })
    ).toHaveValue("真实持久化")
    await dialog
      .getByRole("button", { name: "Create project", exact: true })
      .click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(
      page.getByText("浏览器创建项目", { exact: true })
    ).toBeVisible()
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click()
    await expectUI(
      dialog.getByLabel("Project name", { exact: true })
    ).toHaveValue("")
    await page.keyboard.press("Escape")
    await page.reload()
    await expectUI(
      page.getByText("浏览器创建项目", { exact: true })
    ).toBeVisible()
    await mkdir("test-results/s7", { recursive: true })
    await page.screenshot({
      path: "test-results/s7/project-create.png",
      fullPage: true,
    })
  })

  it("注册后刷新恢复会话，登出后刷新仍需登录，错误密码可纠正重试", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, { ...credentials, name: "S4 用户" })
    await page.getByRole("heading", { name: "选择组织", exact: true }).waitFor()
    await expectUI(page).toHaveURL(/\/app\/select-organization$/)
    await page.reload()
    await page.getByText(credentials.email, { exact: true }).waitFor()
    await page.screenshot({
      path: "test-results/s4-02/organization-empty.png",
      fullPage: true,
    })
    const oldCookies = await context.cookies()
    await page.getByRole("button", { name: "退出登录" }).click()
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    await page.reload()
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    // 通过公开会话接口重放旧 Cookie，证明服务端已撤销，而不只是页面清空状态。
    const revoked = await fetch(`${await app.getUrl()}/api/auth/get-session`, {
      headers: {
        cookie: oldCookies
          .map(({ name, value }) => `${name}=${value}`)
          .join("; "),
      },
    })
    expect(await revoked.json()).toBeNull()
    await expectUI(page).toHaveURL(/\/login$/)
    await page.screenshot({
      path: "test-results/s4-02/login.png",
      fullPage: true,
    })
    await page.getByLabel("邮箱", { exact: true }).fill(credentials.email)
    await page.getByLabel("密码", { exact: true }).fill("incorrect-password")
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await page.getByRole("alert").waitFor()
    await expectUI(
      page.getByRole("heading", { name: "登录", exact: true })
    ).toBeVisible()
    await page.getByLabel("密码", { exact: true }).fill(credentials.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await page.getByRole("heading", { name: "选择组织", exact: true }).waitFor()
  })

  it("无组织用户创建两个组织，切换后刷新保留选择，重复标识不改变当前组织", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "组织创建者",
      email: "organizations@example.test",
      password: credentials.password,
    })
    await expectUI(
      page.getByText("你还没有加入任何组织。", { exact: true })
    ).toBeVisible()
    await page.getByLabel("组织名称", { exact: true }).fill("甲组织")
    await page.getByLabel("组织标识", { exact: true }).fill("organization-a")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "当前组织：甲组织", exact: true })
    ).toBeVisible()
    await page.getByLabel("组织名称", { exact: true }).fill("乙组织")
    await page.getByLabel("组织标识", { exact: true }).fill("organization-b")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "当前组织：乙组织", exact: true })
    ).toBeVisible()
    let releaseRefresh
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve
    })
    await page.route(
      "**/api/auth/organization/get-full-organization",
      async (route) => {
        await refreshGate
        await route.continue()
      }
    )
    const refreshStarted = page.waitForRequest(
      "**/api/auth/organization/get-full-organization"
    )
    await page.getByRole("button", { name: "选择 甲组织", exact: true }).click()
    await refreshStarted
    try {
      await expectUI(
        page.getByRole("button", { name: "选择 甲组织", exact: true })
      ).toBeDisabled()
      await expectUI(
        page.getByLabel("组织名称", { exact: true })
      ).toBeDisabled()
      await expectUI(
        page.getByRole("button", { name: "提交中…", exact: true })
      ).toBeDisabled()
    } finally {
      releaseRefresh()
    }
    // 等待已拦截请求处理完再解除路由，避免与尚在执行的 continue 竞争。
    await page.unrouteAll({ behavior: "wait" })
    await expectUI(
      page.getByRole("heading", { name: "当前组织：甲组织", exact: true })
    ).toBeVisible()
    await page.reload()
    await expectUI(
      page.getByRole("heading", { name: "当前组织：甲组织", exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: "test-results/s4-02/organizations.png",
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390)
    await page.screenshot({
      path: "test-results/s4-02/organizations-mobile.png",
      fullPage: true,
    })
    await page.getByLabel("组织名称", { exact: true }).fill("重复组织")
    await page.getByLabel("组织标识", { exact: true }).fill("organization-a")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page.getByRole("alert")).toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: "当前组织：甲组织", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "选择 重复组织", exact: true })
    ).toHaveCount(0)
    await expectUI(page.getByLabel("组织名称", { exact: true })).toHaveValue(
      "重复组织"
    )
    await expectUI(page.getByLabel("组织标识", { exact: true })).toHaveValue(
      "organization-a"
    )
  })

  it("创建成功后的读回失败只重试读取，恢复后清空已提交草稿", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "刷新测试",
      email: "workspace-refresh@example.test",
      password: credentials.password,
    })
    await expectUI(
      page.getByText("你还没有加入任何组织。", { exact: true })
    ).toBeVisible()
    await page.route("**/api/auth/organization/list", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "TEST_READ_FAILURE",
          message: "组织读取失败",
        }),
      })
    )
    await page.getByLabel("组织名称", { exact: true }).fill("已创建组织")
    await page.getByLabel("组织标识", { exact: true }).fill("refresh-created")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page.getByRole("alert")).toHaveText("组织读取失败")
    await expectUI(
      page.getByRole("button", { name: "创建组织", exact: true })
    ).toHaveCount(0)
    await page.unroute("**/api/auth/organization/list")
    await page.getByRole("button", { name: "重试", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "当前组织：已创建组织", exact: true })
    ).toBeVisible()
    await expectUI(page.getByLabel("组织名称", { exact: true })).toHaveValue("")
    await expectUI(page.getByLabel("组织标识", { exact: true })).toHaveValue("")
    await page.reload()
    await expectUI(
      page.getByRole("heading", { name: "当前组织：已创建组织", exact: true })
    ).toBeVisible()
  })

  it("Platform 使用已有账号登录、恢复会话和登出，不将登录当作平台授权", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "普通账号",
      email: "platform-login@example.test",
      password: credentials.password,
    })
    await page.getByRole("button", { name: "退出登录" }).click()
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    await page.goto(frontends[1].resolvedUrls.local[0] + "platform/")
    await expectUI(
      page.getByRole("heading", { name: "登录", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "创建账号", exact: true })
    ).toHaveCount(0)
    await page
      .getByLabel("邮箱", { exact: true })
      .fill("platform-login@example.test")
    await page.getByLabel("密码", { exact: true }).fill(credentials.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "账户已登录", exact: true })
    ).toBeVisible()
    await page.reload()
    await expectUI(
      page.getByText("platform-login@example.test", { exact: true })
    ).toBeVisible()
    await page.screenshot({
      path: "test-results/s4-02/platform.png",
      fullPage: true,
    })
    await expectUI(
      page.getByRole("button", { name: "创建组织", exact: true })
    ).toHaveCount(0)
    await page.getByRole("button", { name: "退出登录" }).click()
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    await page.reload()
    await expectUI(
      page.getByRole("heading", { name: "登录", exact: true })
    ).toBeVisible()
  })
  it("同一浏览器更换账号后不保留上一账号的组织", async () => {
    await page.goto(
      frontends[0].resolvedUrls.local[0] + "app/select-organization"
    )
    for (const email of [
      "first-account@example.test",
      "second-account@example.test",
    ]) {
      await registerAccount(page, {
        name: "换账号测试",
        email,
        password: credentials.password,
      })
      await expectUI(
        page.getByText("你还没有加入任何组织。", { exact: true })
      ).toBeVisible()
      if (email === "first-account@example.test") {
        await page
          .getByLabel("组织名称", { exact: true })
          .fill("第一个账号的组织")
        await page
          .getByLabel("组织标识", { exact: true })
          .fill("first-account-org")
        await page
          .getByRole("button", { name: "创建组织", exact: true })
          .click()
        await expectUI(
          page.getByRole("heading", { name: "当前组织：第一个账号的组织" })
        ).toBeVisible()
        await page.getByRole("button", { name: "退出登录" }).click()
        await expectUI(
          page.getByRole("heading", { name: "登录", exact: true })
        ).toBeVisible()
      }
    }
    await expectUI(
      page.getByRole("button", { name: "选择 第一个账号的组织" })
    ).toHaveCount(0)
    await page.reload()
    await expectUI(
      page.getByText("你还没有加入任何组织。", { exact: true })
    ).toBeVisible()
  })

  it("恢复会话遇到网络失败时显示错误，恢复网络后可重试", async () => {
    await page.route("**/api/auth/get-session", (route) =>
      route.abort("failed")
    )
    await page.goto(
      frontends[0].resolvedUrls.local[0] + "app/select-organization"
    )
    await expectUI(page.getByRole("alert")).toHaveText("无法恢复会话，请重试。")
    await expectUI(
      page.getByRole("button", { name: "创建组织", exact: true })
    ).toHaveCount(0)
    await page.unroute("**/api/auth/get-session")
    await page.getByRole("button", { name: "重试", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "登录", exact: true })
    ).toBeVisible()
    await expectUI(page).toHaveURL(/\/login$/)
  })

  it("认证请求完成前不能切换登录/注册模式", async () => {
    let releaseRequest
    const requestGate = new Promise((resolve) => {
      releaseRequest = resolve
    })
    await page.route("**/api/auth/sign-up/email", async (route) => {
      await requestGate
      await route.continue()
    })
    await page.goto(frontends[0].resolvedUrls.local[0] + "login")
    await registerAccount(page, {
      name: "慢网账号",
      email: "slow-account@example.test",
      password: credentials.password,
    })
    try {
      await expectUI(
        page.getByRole("button", { name: "提交中…", exact: true })
      ).toBeDisabled()
      await expectUI(
        page.getByRole("button", { name: "已有账号，去登录", exact: true })
      ).toBeDisabled()
    } finally {
      releaseRequest()
    }
    await expectUI(
      page.getByRole("heading", { name: "选择组织", exact: true })
    ).toBeVisible()
  })
})
