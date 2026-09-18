import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer as createNetServer } from "node:net"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { chromium } from "playwright"
import { expect as expectUI } from "playwright/test"
import { GenericContainer, Wait } from "testcontainers"
import { createServer } from "vite"
import { testEmailConfig } from "../setup/email-config.ts"
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

const require = createRequire(import.meta.url)
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")

async function reservePort() {
  const server = createNetServer()
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen)
  )
  const { port } = server.address()
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  )
  return port
}

function newAccount(name) {
  return {
    name,
    email: `${randomUUID()}@example.test`,
    password: randomBytes(24).toString("hex"),
  }
}

describe("email auth UI", () => {
  let postgres
  let mailpit
  let app
  let browser
  let context
  let page
  let pageErrors
  let tenantOrigin
  let platformOrigin
  let mailpitOrigin
  const originalTenantApiProxyTarget = process.env.TENANT_API_PROXY_TARGET
  const frontends = []

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
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    const passwords = Array.from({ length: 4 }, () =>
      randomBytes(24).toString("hex")
    )
    postgres = await new GenericContainer(versions.postgresql.image)
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
    mailpit = await new GenericContainer(versions.mailpit.image)
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp("/", 8025))
      .start()
    const databaseURL = (user, password) =>
      `postgresql://${user}:${password}@${postgres.getHost()}:${postgres.getMappedPort(5432)}/enterprise_admin`
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
    const tenantPort = await reservePort()
    const platformPort = await reservePort()
    const apiPort = await reservePort()
    tenantOrigin = `http://127.0.0.1:${tenantPort}`
    platformOrigin = `http://127.0.0.1:${platformPort}`
    const apiOrigin = `http://127.0.0.1:${apiPort}`
    mailpitOrigin = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
    // Better Auth 把 baseURL 写进验证/重置邮件链接；必须是浏览器真能打开的 API origin。
    app = await createApplication(
      {
        databaseURL: databaseURL("app_runtime", passwords[2]),
        baseURL: apiOrigin,
        secret: randomBytes(32).toString("hex"),
        trustedOrigins: [tenantOrigin, platformOrigin],
        email: testEmailConfig({
          smtp: {
            host: mailpit.getHost(),
            port: mailpit.getMappedPort(1025),
            secure: false,
          },
          linkOrigin: tenantOrigin,
        }),
      },
      { logger: false }
    )
    await app.listen(apiPort, "127.0.0.1")
    app.get(AuthRuntime).startEmailDispatcher()
    process.env.TENANT_API_PROXY_TARGET = apiOrigin
    for (const { name, port } of [
      { name: "tenant", port: tenantPort },
      { name: "platform", port: platformPort },
    ]) {
      const server = await createServer({
        root: resolve(`apps/${name}`),
        configFile: resolve(`apps/${name}/vite.config.ts`),
        server: {
          host: "127.0.0.1",
          port,
          strictPort: true,
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
    try {
      await browser?.close()
    } finally {
      try {
        await Promise.all(frontends.map((server) => server.close()))
      } finally {
        try {
          await app?.close()
        } finally {
          if (originalTenantApiProxyTarget === undefined) {
            delete process.env.TENANT_API_PROXY_TARGET
          } else {
            process.env.TENANT_API_PROXY_TARGET = originalTenantApiProxyTarget
          }
          try {
            await mailpit?.stop()
          } finally {
            await postgres?.stop()
          }
        }
      }
    }
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
