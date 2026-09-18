import { createServer } from "node:net"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import { GenericContainer, Wait } from "testcontainers"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startAuthProbeDatabase } from "../setup/auth-probe-database.mjs"
import { testEmailConfig } from "../setup/email-config.ts"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { createDatabase } from "../../packages/database/dist/index.js"

const require = createRequire(import.meta.url)
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")

async function reservePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  return port
}

describe("auth mail outbox → SMTP → Mailpit", () => {
  let database
  let mailpit
  let app
  let runtime
  let migrator
  let baseURL
  let mailpitOrigin
  const origin = "http://localhost:3200"

  beforeAll(async () => {
    const versions = JSON.parse(
      await readFile("docs/architecture/versions.json", "utf8")
    )
    database = await startAuthProbeDatabase()
    mailpit = await new GenericContainer(versions.mailpit.image)
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp("/", 8025))
      .start()
    const smtpPort = mailpit.getMappedPort(1025)
    mailpitOrigin = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`
    await promisify(execFile)(
      process.execPath,
      ["packages/database/src/migrate.ts"],
      {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: database.url(
            "app_migrator",
            database.passwords[1]
          ),
        },
      }
    )
    migrator = createDatabase(
      database.url("app_migrator", database.passwords[1])
    ).pool
    const apiPort = await reservePort()
    baseURL = `http://127.0.0.1:${apiPort}`
    app = await createApplication(
      {
        databaseURL: database.url("app_runtime", database.passwords[2]),
        baseURL,
        secret: randomBytes(32).toString("hex"),
        trustedOrigins: [origin],
        email: testEmailConfig({
          smtp: {
            host: mailpit.getHost(),
            port: smtpPort,
            secure: false,
          },
          linkOrigin: origin,
        }),
      },
      { logger: ["error"] }
    )
    await app.listen(apiPort, "127.0.0.1")
    runtime = app.get(AuthRuntime)
    runtime.startEmailDispatcher()
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await migrator?.end()
    await mailpit?.stop()
    await database?.container.stop()
  })

  it("sends a verify-email message and the link verifies the user", async () => {
    const email = `${randomUUID()}@example.test`
    const password = randomBytes(24).toString("hex")
    const signup = await fetch(`${baseURL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email,
        password,
        name: "Mail user",
        callbackURL: `${origin}/auth/verified`,
      }),
    })
    expect(signup.status).toBe(200)
    const payload = await signup.json()
    expect(payload.token).toBeNull()
    const message = await waitForMail(mailpitOrigin, email, "验证你的邮箱")
    const verifyUrl = firstHttpUrl(message.HTML)
    const verified = await fetch(verifyUrl, { redirect: "manual" })
    expect(verified.status).toBeGreaterThanOrEqual(300)
    expect(verified.status).toBeLessThan(400)
    expect(verified.headers.get("location")).toBe(`${origin}/auth/verified`)
    const signIn = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    })
    expect(signIn.status).toBe(200)
  })

  it("sends a password-reset message after a verified account requests it", async () => {
    const account = await signUpVerified(baseURL, origin, migrator, {
      name: "Reset user",
    })
    const reset = await fetch(`${baseURL}/api/auth/request-password-reset`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        email: account.email,
        redirectTo: `${origin}/reset-password`,
      }),
    })
    expect(reset.status).toBe(200)
    const message = await waitForMail(
      mailpitOrigin,
      account.email,
      "重置你的密码"
    )
    expect(firstHttpUrl(message.HTML)).toContain("/reset-password")
  })

  it("sends an organization invitation to the tenant accept-invitation URL", async () => {
    const account = await signUpVerified(baseURL, origin, migrator, {
      name: "Owner",
    })
    const organization = await runtime.auth.api.createOrganization({
      headers: account.headers,
      body: { name: "Mail org", slug: randomUUID() },
    })
    const invitee = `${randomUUID()}@example.test`
    const invited = await fetch(
      `${baseURL}/api/auth/organization/invite-member`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: account.cookie,
        },
        body: JSON.stringify({
          email: invitee,
          role: "member",
          organizationId: organization.id,
        }),
      }
    )
    expect(invited.status).toBe(200)
    const message = await waitForMail(
      mailpitOrigin,
      invitee,
      "你收到一个组织邀请：Mail org"
    )
    expect(firstHttpUrl(message.HTML)).toMatch(
      /^http:\/\/localhost:3200\/accept-invitation\/[0-9a-f-]+$/
    )
  })
})
