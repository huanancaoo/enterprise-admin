import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
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
import { createApplication } from "../../apps/api/dist/create-application.js"

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
  let browser
  let context
  let page
  let pageErrors
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
    await app.listen(0, "127.0.0.1")
    for (const name of ["admin", "platform"]) {
      const server = await createServer({
        root: resolve(`apps/${name}`),
        configFile: resolve(`apps/${name}/vite.config.ts`),
        server: {
          host: "127.0.0.1",
          port: 0,
          proxy: { "/api/auth": await app.getUrl() },
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
          await container?.stop()
        }
      }
    }
  })

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
