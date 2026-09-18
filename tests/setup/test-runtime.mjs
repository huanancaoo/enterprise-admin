import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { createServer as createNetServer } from "node:net"
import { resolve } from "node:path"
import { promisify } from "node:util"
import { GenericContainer, Wait } from "testcontainers"
import { createDatabase } from "../../packages/database/dist/index.js"
import { startAuthProbeDatabase } from "./auth-probe-database.mjs"
import { testEmailConfig } from "./email-config.ts"

const require = createRequire(import.meta.url)
// 必须与生产 CJS 使用同一个 Nest 注入令牌。
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/identity/auth-runtime.js")
const { EmailRuntime } = require("../../apps/api/dist/email/email-runtime.js")

async function reservePort() {
  const server = createNetServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

export async function startTestApplication({
  origins = ["http://localhost:3200"],
  mail = false,
} = {}) {
  // 每取得一个资源立即登记释放；启动中途失败和正常结束使用同一条逆序清理链。
  const resources = new AsyncDisposableStack()
  try {
    const database = await startAuthProbeDatabase()
    resources.defer(() => database.container.stop())
    const runtimeURL = database.url("app_runtime", database.passwords[2])
    const migrationURL = database.url("app_migrator", database.passwords[1])
    await promisify(execFile)(
      process.execPath,
      ["packages/database/src/migrate.ts"],
      {
        env: { PATH: process.env.PATH, MIGRATION_DATABASE_URL: migrationURL },
      }
    )
    const migrator = createDatabase(migrationURL).pool
    resources.defer(() => migrator.end())
    let mailpitOrigin
    let smtp
    if (mail) {
      const versions = JSON.parse(
        await readFile("docs/architecture/versions.json", "utf8")
      )
      const mailpit = await new GenericContainer(versions.mailpit.image)
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forHttp("/", 8025))
        .start()
      resources.defer(() => mailpit.stop())
      smtp = {
        host: mailpit.getHost(),
        port: mailpit.getMappedPort(1025),
        secure: false,
      }
      mailpitOrigin = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
    }
    const port = await reservePort()
    const baseURL = `http://127.0.0.1:${port}`
    const config = {
      databaseURL: runtimeURL,
      baseURL,
      secret: randomBytes(32).toString("hex"),
      trustedOrigins: origins,
      email: testEmailConfig({
        linkOrigin: origins[0],
        ...(smtp ? { smtp } : {}),
      }),
    }
    const app = await createApplication(config, { logger: ["error"] })
    resources.defer(() => app.close())
    await app.listen(port, "127.0.0.1")
    if (mail) app.get(EmailRuntime).start()
    return {
      app,
      runtime: app.get(AuthRuntime),
      migrator,
      baseURL,
      mailpitOrigin,
      config,
      close: () => resources.disposeAsync(),
    }
  } catch (error) {
    try {
      await resources.disposeAsync()
    } catch (cleanupError) {
      throw new SuppressedError(
        cleanupError,
        error,
        "测试启动与资源释放同时失败"
      )
    }
    throw error
  }
}

export async function startBrowserApplication({ mail = false } = {}) {
  const resources = new AsyncDisposableStack()
  try {
    const tenantPort = await reservePort()
    const platformPort = await reservePort()
    const tenantOrigin = `http://127.0.0.1:${tenantPort}`
    const platformOrigin = `http://127.0.0.1:${platformPort}`
    const runtime = await startTestApplication({
      origins: [tenantOrigin, platformOrigin],
      mail,
    })
    resources.defer(() => runtime.close())
    const { createServer } = await import("vite")
    for (const { name, port, prefix } of [
      { name: "tenant", port: tenantPort, prefix: "/api" },
      { name: "platform", port: platformPort, prefix: "/api/auth" },
    ]) {
      const server = await createServer({
        root: resolve(`apps/${name}`),
        configFile: resolve(`apps/${name}/vite.config.ts`),
        // 每个 Vite 实例持有自己的目标；测试不再改写进程级代理环境变量。
        server: {
          host: "127.0.0.1",
          port,
          strictPort: true,
          proxy: { [prefix]: runtime.baseURL },
        },
      })
      resources.defer(() => server.close())
      await server.listen()
    }
    const { chromium } = await import("playwright")
    const browser = await chromium.launch()
    resources.defer(() => browser.close())
    return {
      ...runtime,
      browser,
      tenantOrigin,
      platformOrigin,
      close: () => resources.disposeAsync(),
    }
  } catch (error) {
    try {
      await resources.disposeAsync()
    } catch (cleanupError) {
      throw new SuppressedError(
        cleanupError,
        error,
        "测试启动与资源释放同时失败"
      )
    }
    throw error
  }
}
