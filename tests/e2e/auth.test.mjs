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
import {
  projects,
  projectTranslations,
} from "../../packages/database/dist/schema/projects.js"
import { auditEvents } from "../../packages/database/dist/schema/audit.js"
import { eq } from "../../packages/database/node_modules/drizzle-orm/index.js"

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

async function openAdminUserMenu(page, userName) {
  await page.getByRole("button", { name: new RegExp(userName) }).click()
}

async function selectAdminLocale(page, userName, currentLanguage, locale) {
  await openAdminUserMenu(page, userName)
  await page
    .getByRole("menuitem", { name: currentLanguage, exact: true })
    .click()
  await page.getByRole("menuitemradio", { name: locale, exact: true }).click()
}

async function signOutFromAppShell(page, userName) {
  await openAdminUserMenu(page, userName)
  await page.getByRole("menuitem", { name: "退出登录", exact: true }).click()
}

async function signOutFromGate(page) {
  await page.getByRole("button", { name: "退出登录", exact: true }).click()
}

async function createOrganizationFromSwitcher(
  page,
  activeOrganizationName,
  organization
) {
  await page
    .getByRole("button", { name: new RegExp(activeOrganizationName) })
    .click()
  await page.getByRole("menuitem", { name: "创建组织", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("组织名称", { exact: true }).fill(organization.name)
  await dialog.getByLabel("组织标识", { exact: true }).fill(organization.slug)
  await dialog.getByRole("button", { name: "创建组织", exact: true }).click()
}

async function signInAccount(page, account) {
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
}

async function selectOrganizationFromAppShell(
  page,
  activeOrganizationName,
  nextOrganizationName
) {
  await page
    .getByRole("button", { name: new RegExp(activeOrganizationName) })
    .click()
  await page
    .getByRole("menuitem", { name: new RegExp(nextOrganizationName) })
    .click()
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
    return createTenantRunner(runtime.pool)(tenant, async (tx) => {
      const target = await projectRepository.create(tx, {
        name: "页外目标项目",
        description: "中文详情",
        contentLocale: "zh-CN",
      })
      await tx.insert(projectTranslations).values({
        organizationId,
        projectId: target.id,
        locale: "en-US",
        name: "Off-page target project",
        description: null,
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
      return target
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
      await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
      const organizationId = new URL(page.url()).pathname.split("/").at(-1)
      expect(organizationId).toBeTruthy()
      const cookie = (await context.cookies())
        .map(({ name, value }) => `${name}=${value}`)
        .join("; ")
      const otherOrganization = await runtime.auth.api.createOrganization({
        headers: new Headers({ cookie }),
        body: {
          name: "详情切换组织",
          slug: "project-detail-switch",
          keepCurrentActiveOrganization: true,
        },
      })
      const target = await seedProjectsOutsideFirstPage(
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
      await page.getByRole("button", { name: "搜索", exact: true }).click()
      await targetRequest
      await expectUI(
        page.getByText("页外目标项目", { exact: true })
      ).toBeVisible()
      const filteredListURL = new URL(page.url())
      expect(filteredListURL.searchParams.get("name")).toBe("页外目标项目")
      expect(filteredListURL.searchParams.get("page")).toBe("1")
      expect(filteredListURL.searchParams.get("pageSize")).toBe("20")
      await page
        .getByRole("link", { name: "页外目标项目", exact: true })
        .click()
      await expectUI(page).toHaveURL(
        new RegExp(`/app/projects/${organizationId}/${target.id}$`)
      )
      await expectUI(
        page.getByRole("heading", { name: "页外目标项目", exact: true })
      ).toBeVisible()
      await expectUI(page.getByText("中文详情", { exact: true })).toBeVisible()
      await page.reload()
      await expectUI(
        page.getByRole("heading", { name: "页外目标项目", exact: true })
      ).toBeVisible()
      await selectAdminLocale(page, "项目列表用户", "语言", "English")
      await expectUI(
        page.getByRole("heading", {
          name: "Off-page target project",
          exact: true,
        })
      ).toBeVisible()
      await expectUI(
        page.getByText("No description", { exact: true })
      ).toBeVisible()
      const detailURL = new URL(page.url())
      expect(detailURL.pathname).toBe(
        `/app/projects/${organizationId}/${target.id}`
      )
      await selectOrganizationFromAppShell(page, "项目列表组织", "详情切换组织")
      await expectUI(page).toHaveURL(
        new RegExp(`/app/projects/${otherOrganization.id}(?:\\?.*)?$`)
      )
      await expectUI(
        page.getByRole("heading", {
          name: "Off-page target project",
          exact: true,
        })
      ).toHaveCount(0)
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
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
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
    await selectAdminLocale(page, "项目创建用户", "语言", "English")
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

  it("项目编辑按目标内容语言保存草稿、状态与真实译文", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "项目编辑用户",
      email: "project-edit-browser@example.test",
      password: credentials.password,
    })
    await page.getByLabel("组织名称", { exact: true }).fill("项目编辑组织")
    await page.getByLabel("组织标识", { exact: true }).fill("project-edit")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    const organizationId = new URL(page.url()).pathname.split("/").at(-1)
    expect(organizationId).toBeTruthy()
    const cookie = (await context.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ")
    const tenant = await tenantContexts.resolve(
      new Headers({ cookie }),
      String(organizationId),
      { project: ["create"] },
      "e2e-project-edit-seed",
      new RequestLanguage(null)
    )
    const project = await createTenantRunner(runtime.pool)(tenant, (tx) =>
      projectRepository.create(tx, {
        name: "中文基础内容",
        description: "基础描述",
        contentLocale: "zh-CN",
      })
    )
    await page.reload()
    await page.getByRole("link", { name: "中文基础内容", exact: true }).click()
    await page.getByRole("button", { name: "编辑项目", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("编辑内容语言", { exact: true }).click()
    await page.getByRole("option", { name: "English", exact: true }).click()
    // 英文尚无记录；编辑器必须为空，而非把详情回退得到的中文基础译文当成英文。
    await expectUI(dialog.getByLabel("项目名称", { exact: true })).toHaveValue(
      ""
    )
    await dialog.getByLabel("项目名称", { exact: true }).fill("English draft")
    await dialog.getByLabel("状态", { exact: true }).click()
    await page.getByRole("option", { name: "活跃", exact: true }).click()
    await dialog.getByLabel("语言", { exact: true }).click()
    await page.getByRole("option", { name: "العربية", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    // 目标内容语言与界面语言分离；这里必须切到不同语言，才能证明界面刷新没有篡改英文草稿。
    await expectUI(dialog.locator("#project-edit-content-locale")).toHaveText(
      /en-US/
    )
    await expectUI(dialog.locator("#project-edit-name")).toHaveValue(
      "English draft"
    )
    await dialog.getByLabel("اللغة", { exact: true }).click()
    await page.getByRole("option", { name: "简体中文", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "ltr")
    await page.route("**/api/v1/organizations/*/projects/*", async (route) => {
      if (route.request().method() === "PATCH") await route.abort()
      else await route.continue()
    })
    await dialog.getByRole("button", { name: "保存项目", exact: true }).click()
    await expectUI(dialog.getByRole("alert")).toBeVisible()
    await expectUI(dialog.getByLabel("项目名称", { exact: true })).toHaveValue(
      "English draft"
    )
    await page.unroute("**/api/v1/organizations/*/projects/*")
    await dialog.getByRole("button", { name: "保存项目", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    await expectUI(page.getByText(/^(活跃|Active)$/)).toBeVisible()
    await page.reload()
    await expectUI(page.getByText(/^(活跃|Active)$/)).toBeVisible()
    await page
      .getByRole("button", { name: /^(编辑项目|Edit project)$/ })
      .click()
    await dialog.getByLabel(/^(编辑内容语言|Content language to edit)$/).click()
    await page.getByRole("option", { name: "English", exact: true }).click()
    await expectUI(dialog.getByLabel(/^(项目名称|Project name)$/)).toHaveValue(
      "English draft"
    )
    await mkdir("test-results/s7", { recursive: true })
    await page.screenshot({
      path: `test-results/s7/project-edit-${project.id}.png`,
      fullPage: true,
    })
  })

  it("从真实详情确认硬删除项目后，列表与详情不再展示旧数据", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "项目删除用户",
      email: "project-delete-browser@example.test",
      password: credentials.password,
    })
    await page.getByLabel("组织名称", { exact: true }).fill("项目删除组织")
    await page.getByLabel("组织标识", { exact: true }).fill("project-delete")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    const organizationId = new URL(page.url()).pathname.split("/").at(-1)
    expect(organizationId).toBeTruthy()
    await page.getByRole("button", { name: "创建项目", exact: true }).click()
    const createDialog = page.getByRole("dialog")
    await createDialog
      .getByLabel("项目名称", { exact: true })
      .fill("浏览器删除项目")
    await createDialog
      .getByRole("button", { name: "创建项目", exact: true })
      .click()
    await page
      .getByRole("link", { name: "浏览器删除项目", exact: true })
      .click()
    const projectId = new URL(page.url()).pathname.split("/").at(-1)
    expect(projectId).toBeTruthy()

    await page.getByRole("button", { name: "删除项目", exact: true }).click()
    const confirmation = page.getByRole("alertdialog")
    await confirmation
      .getByRole("button", { name: "取消", exact: true })
      .click()
    await expectUI(confirmation).toHaveCount(0)
    await expectUI(
      page.getByRole("heading", { name: "浏览器删除项目", exact: true })
    ).toBeVisible()

    const deletion = page.waitForRequest((request) => {
      const url = new URL(request.url())
      return (
        request.method() === "DELETE" &&
        url.pathname ===
          `/api/v1/organizations/${organizationId}/projects/${projectId}`
      )
    })
    await page.getByRole("button", { name: "删除项目", exact: true }).click()
    await confirmation
      .getByRole("button", { name: "删除项目", exact: true })
      .click()
    await deletion
    await expectUI(page).toHaveURL(
      new RegExp(`/app/projects/${organizationId}(?:\\?.*)?$`)
    )
    await expectUI(
      page.getByRole("link", { name: "浏览器删除项目", exact: true })
    ).toHaveCount(0)

    const cookie = (await context.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ")
    const tenant = await tenantContexts.resolve(
      new Headers({ cookie }),
      String(organizationId),
      { project: ["read"] },
      "e2e-project-delete-inspect",
      new RequestLanguage(null)
    )
    const state = await createTenantRunner(runtime.pool)(
      tenant,
      async (tx) => ({
        project: await projectRepository.find(tx, String(projectId)),
        translations: await projectRepository.translations(
          tx,
          String(projectId)
        ),
        audits: await tx.select().from(auditEvents),
      })
    )
    expect(state.project).toBeUndefined()
    expect(state.translations).toEqual([])
    expect(
      state.audits.some(
        (event) =>
          event.resourceId === projectId &&
          event.eventCode === "project.deleted"
      )
    ).toBe(true)

    await page.goto(
      `${frontends[0].resolvedUrls.local[0]}app/projects/${organizationId}/${projectId}`
    )
    await expectUI(
      page.getByRole("heading", { name: "未找到项目", exact: true })
    ).toBeVisible()
  })

  it("S7：完整业务流程 Login → Org → Create → Edit → DataTable Filter/Sort/Pagination → Delete 并验证审计与持久化", async () => {
    // 1. 真实登录与创建组织
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "全流程用户",
      email: "project-full-flow@example.test",
      password: credentials.password,
    })
    await page.getByLabel("组织名称", { exact: true }).fill("全流程验收组织")
    await page.getByLabel("组织标识", { exact: true }).fill("full-flow-org")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    const organizationId = new URL(page.url()).pathname.split("/").at(-1)
    expect(organizationId).toBeTruthy()

    // 2. 预置数据（10 个草稿、10 个活跃、4 个已归档），构造多状态且跨页（>20 条）的数据集
    const cookie = (await context.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ")
    const tenant = await tenantContexts.resolve(
      new Headers({ cookie }),
      String(organizationId),
      { project: ["create", "update", "delete"] },
      "e2e-full-workflow-seed",
      new RequestLanguage(null)
    )
    await createTenantRunner(runtime.pool)(tenant, async (tx) => {
      for (let i = 1; i <= 24; i += 1) {
        const status = i <= 10 ? "draft" : i <= 20 ? "active" : "archived"
        const p = await projectRepository.create(tx, {
          name: `批量项目 ${String(i).padStart(2, "0")}`,
          description: `批量描述 ${i}`,
          contentLocale: "zh-CN",
        })
        if (status !== "draft") {
          await projectRepository.updateStatus(tx, p.id, status)
        }
        const fakeDate = new Date(Date.UTC(2026, 0, i, 10, 0, 0))
        await tx
          .update(projects)
          .set({ createdAt: fakeDate, updatedAt: fakeDate })
          .where(eq(projects.id, p.id))
      }
    })

    await page.reload()
    await expectUI(page.getByText("共 24 条")).toBeVisible()

    // 3. 真实弹窗创建主项目，验证列表实时展示与总数累加
    await page.getByRole("button", { name: "创建项目", exact: true }).click()
    const createDialog = page.getByRole("dialog")
    await createDialog
      .getByLabel("项目名称", { exact: true })
      .fill("全流程核心项目")
    await createDialog
      .getByLabel("描述", { exact: true })
      .fill("核心项目初始草稿描述")
    await createDialog
      .getByRole("button", { name: "创建项目", exact: true })
      .click()
    await expectUI(createDialog).toHaveCount(0)
    await expectUI(
      page.getByText("全流程核心项目", { exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("共 25 条")).toBeVisible()

    // 4. 进入详情，编辑状态为“活跃”并补充英文译文，验证 RTL 切换下草稿保持与最终持久化
    await page
      .getByRole("link", { name: "全流程核心项目", exact: true })
      .click()
    await expectUI(page).toHaveURL(
      new RegExp(`/app/projects/${organizationId}/[0-9a-f-]+$`)
    )
    const projectId = new URL(page.url()).pathname.split("/").at(-1)
    expect(projectId).toBeTruthy()

    await expectUI(
      page.getByRole("heading", { name: "全流程核心项目", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByText("核心项目初始草稿描述", { exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("草稿", { exact: true })).toBeVisible()

    await page.getByRole("button", { name: "编辑项目", exact: true }).click()
    const editDialog = page.getByRole("dialog")

    // 维护英文译文（先选内容语言，再填写内容与调整状态）
    await editDialog.getByLabel("编辑内容语言", { exact: true }).click()
    await page.getByRole("option", { name: "English", exact: true }).click()
    await editDialog
      .getByLabel("项目名称", { exact: true })
      .fill("Core Workflow Project")
    await editDialog
      .getByLabel("描述", { exact: true })
      .fill("Core project English description")

    // 修改状态为“活跃”
    await editDialog.getByLabel("状态", { exact: true }).click()
    await page.getByRole("option", { name: "活跃", exact: true }).click()

    // 验证切换界面语言为阿拉伯文（RTL）时保留英文草稿
    await editDialog.getByLabel("语言", { exact: true }).click()
    await page.getByRole("option", { name: "العربية", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expectUI(
      editDialog.locator("#project-edit-content-locale")
    ).toHaveText(/en-US/)
    await expectUI(editDialog.locator("#project-edit-name")).toHaveValue(
      "Core Workflow Project"
    )

    // 切回简体中文界面提交
    await editDialog.getByLabel("اللغة", { exact: true }).click()
    await page.getByRole("option", { name: "简体中文", exact: true }).click()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "ltr")

    await editDialog
      .getByRole("button", { name: "保存项目", exact: true })
      .click()
    await expectUI(editDialog).toHaveCount(0)
    await expectUI(page.getByText("活跃", { exact: true })).toBeVisible()

    await page.reload()
    await expectUI(page.getByText("活跃", { exact: true })).toBeVisible()

    // 切换界面语言为 English，验证详情根据请求语言正确解析整条英文译文
    await selectAdminLocale(page, "全流程用户", "语言", "English")
    await expectUI(
      page.getByRole("heading", {
        name: "Core Workflow Project",
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByText("Core project English description", { exact: true })
    ).toBeVisible()

    // 切回简体中文
    await selectAdminLocale(page, "全流程用户", "Language", "简体中文")
    await expectUI(
      page.getByRole("heading", { name: "全流程核心项目", exact: true })
    ).toBeVisible()

    // 5. 返回列表，验证 DataTable 内置交互（状态筛选、名称搜索、时间排序、分页以及刷新保留）
    await page.getByRole("link", { name: "返回项目列表", exact: true }).click()
    await expectUI(page).toHaveURL(
      new RegExp(`/app/projects/${organizationId}(?:\\?.*)?$`)
    )

    // 5a. 状态筛选：筛选“活跃”状态（10 个预置活跃 + 1 个主项目 = 11 条）
    await page.getByRole("button", { name: /^状态/ }).click()
    await page.getByRole("option", { name: "活跃" }).click()
    await expectUI(page).toHaveURL(/status=active/)
    await expectUI(
      page.getByText("全流程核心项目", { exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("共 11 条")).toBeVisible()

    // 取消状态筛选，恢复全部 25 条
    await page.getByRole("option", { name: "活跃" }).click()
    await expectUI(page.getByText("共 25 条")).toBeVisible()
    await page.keyboard.press("Escape")

    // 5b. 名称搜索：命中核心项目，并同步 URL
    await page
      .getByRole("textbox", { name: "搜索项目名称", exact: true })
      .fill("全流程核心项目")
    await page.getByRole("button", { name: "搜索", exact: true }).click()
    await expectUI(page).toHaveURL(/name=/)
    await expectUI(
      page.getByText("全流程核心项目", { exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("共 1 条")).toBeVisible()

    // 清空搜索恢复全部数据
    await page
      .getByRole("textbox", { name: "搜索项目名称", exact: true })
      .fill("")
    await page.getByRole("button", { name: "搜索", exact: true }).click()
    await expectUI(page.getByText("共 25 条")).toBeVisible()

    // 5c. 列头排序：点击“创建时间”切换排序
    await page.getByRole("button", { name: "创建时间", exact: true }).click()
    await expectUI(page).toHaveURL(/sortBy=createdAt/)

    // 5d. 分页导航：点击第 2 页，验证 URL 更新为 page=2 且展示跨页剩余数据
    await page.getByRole("button", { name: "2", exact: true }).click()
    await expectUI(page).toHaveURL(/page=2/)
    await expectUI(page.getByText("共 25 条")).toBeVisible()

    // 5e. 刷新保留筛选/分页/排序条件
    await page.reload()
    await expectUI(page).toHaveURL(/page=2/)
    await expectUI(page).toHaveURL(/sortBy=createdAt/)
    await expectUI(page.getByText("共 25 条")).toBeVisible()

    // 切回第 1 页
    await page.getByRole("button", { name: "1", exact: true }).click()
    await expectUI(page).toHaveURL(/page=1/)

    // 再次点击“创建时间”切换排序回降序，确保主项目在第 1 页
    await page.getByRole("button", { name: "创建时间", exact: true }).click()
    await expectUI(page).toHaveURL(/sortOrder=desc/)
    await expectUI(
      page.getByRole("link", { name: "全流程核心项目", exact: true })
    ).toBeVisible()

    // 6. 进入详情并确认硬删除，验证列表同步移出、总数递减以及 404
    await page
      .getByRole("link", { name: "全流程核心项目", exact: true })
      .click()
    await expectUI(page).toHaveURL(
      new RegExp(`/app/projects/${organizationId}/${projectId}$`)
    )

    await page.getByRole("button", { name: "删除项目", exact: true }).click()
    const alertDialog = page.getByRole("alertdialog")
    await alertDialog.getByRole("button", { name: "取消", exact: true }).click()
    await expectUI(alertDialog).toHaveCount(0)
    await expectUI(
      page.getByRole("heading", { name: "全流程核心项目", exact: true })
    ).toBeVisible()

    await page.getByRole("button", { name: "删除项目", exact: true }).click()
    await alertDialog
      .getByRole("button", { name: "删除项目", exact: true })
      .click()

    await expectUI(page).toHaveURL(
      new RegExp(`/app/projects/${organizationId}(?:\\?.*)?$`)
    )
    await expectUI(
      page.getByRole("link", { name: "全流程核心项目", exact: true })
    ).toHaveCount(0)
    await expectUI(page.getByText("共 24 条")).toBeVisible()

    // 直接访问详情返回 404
    await page.goto(
      `${frontends[0].resolvedUrls.local[0]}app/projects/${organizationId}/${projectId}`
    )
    await expectUI(
      page.getByRole("heading", { name: "未找到项目", exact: true })
    ).toBeVisible()

    // 7. 数据库不变量与审计不可篡改性校验
    const dbState = await createTenantRunner(runtime.pool)(
      tenant,
      async (tx) => ({
        project: await projectRepository.find(tx, String(projectId)),
        translations: await projectRepository.translations(
          tx,
          String(projectId)
        ),
        audits: await tx.select().from(auditEvents),
      })
    )
    expect(dbState.project).toBeUndefined()
    expect(dbState.translations).toEqual([])

    const projectAudits = dbState.audits.filter(
      (event) => event.resourceId === projectId
    )
    expect(
      projectAudits.some((event) => event.eventCode === "project.created")
    ).toBe(true)
    expect(
      projectAudits.some((event) => event.eventCode === "project.updated")
    ).toBe(true)
    expect(
      projectAudits.some(
        (event) => event.eventCode === "project.translation.updated"
      )
    ).toBe(true)
    expect(
      projectAudits.some((event) => event.eventCode === "project.deleted")
    ).toBe(true)

    await mkdir("test-results/s7", { recursive: true })
    await page.screenshot({
      path: "test-results/s7/workflow-success.png",
      fullPage: true,
    })
  })

  it("注册后刷新恢复会话，登出后刷新仍需登录，错误密码可纠正重试", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, { ...credentials, name: "S4 用户" })
    await page.getByRole("heading", { name: "创建组织", exact: true }).waitFor()
    await expectUI(page).toHaveURL(/\/app\/select-organization$/)
    await page.reload()
    await page.getByText(credentials.email, { exact: true }).waitFor()
    await page.screenshot({
      path: "test-results/s4-02/organization-empty.png",
      fullPage: true,
    })
    const oldCookies = await context.cookies()
    await signOutFromGate(page)
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
    await page.getByRole("heading", { name: "创建组织", exact: true }).waitFor()
  })

  it("无组织用户创建两个组织，切换后刷新保留选择，重复标识不改变当前组织", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "组织创建者",
      email: "organizations@example.test",
      password: credentials.password,
    })
    await expectUI(
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toBeVisible()
    await page.getByLabel("组织名称", { exact: true }).fill("甲组织")
    await page.getByLabel("组织标识", { exact: true }).fill("organization-a")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await expectUI(page.getByRole("button", { name: /甲组织/ })).toBeVisible()
    await createOrganizationFromSwitcher(page, "甲组织", {
      name: "乙组织",
      slug: "organization-b",
    })
    await expectUI(page.getByRole("button", { name: /乙组织/ })).toBeVisible()
    let releaseRefresh
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve
    })
    await page.route("**/api/v1/me/organizations", async (route) => {
      await refreshGate
      await route.continue()
    })
    const refreshStarted = page.waitForRequest("**/api/v1/me/organizations")
    const activeTeamSwitcher = page.getByRole("button", { name: /乙组织/ })
    await selectOrganizationFromAppShell(page, "乙组织", "甲组织")
    await refreshStarted
    try {
      await expectUI(activeTeamSwitcher).toHaveAttribute("data-disabled", "")
    } finally {
      releaseRefresh()
    }
    // 等待已拦截请求处理完再解除路由，避免与尚在执行的 continue 竞争。
    await page.unrouteAll({ behavior: "wait" })
    await expectUI(page.getByRole("button", { name: /甲组织/ })).toBeVisible()
    await page.reload()
    await expectUI(page.getByRole("button", { name: /甲组织/ })).toBeVisible()
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
    // 窄屏只验证工作区不横向溢出；切换器在侧栏抽屉里，后续创建断言回到桌面视口。
    await page.setViewportSize({ width: 1280, height: 800 })
    const organizationURL = page.url()
    await page.getByRole("button", { name: /甲组织/ }).click()
    await page.getByRole("menuitem", { name: "创建组织", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("组织名称", { exact: true }).fill("重复组织")
    await dialog.getByLabel("组织标识", { exact: true }).fill("organization-a")
    await dialog.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(dialog.getByRole("alert")).toBeVisible()
    expect(page.url()).toBe(organizationURL)
    await expectUI(dialog.getByLabel("组织名称", { exact: true })).toHaveValue(
      "重复组织"
    )
    await expectUI(dialog.getByLabel("组织标识", { exact: true })).toHaveValue(
      "organization-a"
    )
  })

  it("已有一个组织的用户登录后进入该组织工作区", async () => {
    const account = {
      name: "单组织用户",
      email: "single-org-login@example.test",
      password: credentials.password,
    }
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, account)
    await page.getByLabel("组织名称", { exact: true }).fill("唯一组织")
    await page.getByLabel("组织标识", { exact: true }).fill("only-org")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await expectUI(page.getByRole("button", { name: /唯一组织/ })).toBeVisible()
    await signOutFromAppShell(page, account.name)
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    await signInAccount(page, account)
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await expectUI(
      page.getByRole("heading", { name: "项目", exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("还没有项目", { exact: true })).toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toHaveCount(0)
  })

  it("已有多个组织的用户登录后选择已有组织进入", async () => {
    const account = {
      name: "多组织用户",
      email: "multi-org-login@example.test",
      password: credentials.password,
    }
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, account)
    await page.getByLabel("组织名称", { exact: true }).fill("北区组织")
    await page.getByLabel("组织标识", { exact: true }).fill("north-org")
    await page.getByRole("button", { name: "创建组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await createOrganizationFromSwitcher(page, "北区组织", {
      name: "南区组织",
      slug: "south-org",
    })
    await expectUI(page.getByRole("button", { name: /南区组织/ })).toBeVisible()
    await signOutFromAppShell(page, account.name)
    await page.getByRole("heading", { name: "登录", exact: true }).waitFor()
    await signInAccount(page, account)
    await expectUI(page).toHaveURL(/\/app\/select-organization$/)
    await expectUI(
      page.getByRole("heading", { name: "选择组织", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("link", { name: "北区组织", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("link", { name: "南区组织", exact: true })
    ).toBeVisible()
    await page.getByRole("link", { name: "北区组织", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await expectUI(
      page.getByRole("heading", { name: "项目", exact: true })
    ).toBeVisible()
    await expectUI(page.getByText("还没有项目", { exact: true })).toBeVisible()
    await expectUI(
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toHaveCount(0)
  })

  it("创建成功后的读回失败只重试读取，恢复后清空已提交草稿", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "刷新测试",
      email: "workspace-refresh@example.test",
      password: credentials.password,
    })
    await expectUI(
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toBeVisible()
    await page.route("**/api/v1/me/organizations", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "INTERNAL_ERROR",
          message: "组织读取失败",
          requestId: "workspace-refresh-test",
          locale: "zh-CN",
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
    await page.unroute("**/api/v1/me/organizations")
    await page.getByRole("button", { name: "重试", exact: true }).click()
    await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
    await expectUI(
      page.getByRole("heading", { name: "项目", exact: true })
    ).toBeVisible()
    await page.reload()
    await expectUI(
      page.getByRole("heading", { name: "项目", exact: true })
    ).toBeVisible()
  })

  it("Platform 使用已有账号登录、恢复会话和登出，不将登录当作平台授权", async () => {
    await page.goto(frontends[0].resolvedUrls.local[0] + "app/")
    await registerAccount(page, {
      name: "普通账号",
      email: "platform-login@example.test",
      password: credentials.password,
    })
    await signOutFromGate(page)
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
    await signOutFromAppShell(page, "普通账号")
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
        page.getByRole("heading", { name: "创建组织", exact: true })
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
        await expectUI(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+(?:\?.*)?$/)
        await expectUI(
          page.getByRole("button", { name: /第一个账号的组织/ })
        ).toBeVisible()
        await signOutFromAppShell(page, "换账号测试")
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
      page.getByRole("heading", { name: "创建组织", exact: true })
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
      page.getByRole("heading", { name: "创建组织", exact: true })
    ).toBeVisible()
  })
})
