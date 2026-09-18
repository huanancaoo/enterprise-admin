import { startAuthProbeDatabase } from "../setup/auth-probe-database.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { testEmailConfig } from "../setup/email-config.ts"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { createDatabase } from "../../packages/database/dist/index.js"

const require = createRequire(import.meta.url)
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")

describe("platform assignment access boundary", () => {
  let container, app, runtime, migrator, baseURL
  const origin = "http://localhost:3201"
  const signup = () =>
    signUpVerified(baseURL, origin, migrator, { name: "Member" })
  const json = (response) => response.json()
  const platformAccess = (cookie) =>
    fetch(`${baseURL}/api/v1/me/platform`, {
      headers: cookie ? { cookie } : {},
    })

  beforeAll(async () => {
    const database = await startAuthProbeDatabase()
    container = database.container
    const { url, passwords } = database
    await promisify(execFile)(
      process.execPath,
      ["packages/database/src/migrate.ts"],
      {
        env: {
          PATH: process.env.PATH,
          MIGRATION_DATABASE_URL: url("app_migrator", passwords[1]),
        },
      }
    )
    migrator = createDatabase(url("app_migrator", passwords[1])).pool
    app = await createApplication(
      {
        databaseURL: url("app_runtime", passwords[2]),
        baseURL: "http://localhost:3000",
        secret: randomBytes(32).toString("hex"),
        trustedOrigins: [origin],
        email: testEmailConfig(),
      },
      { logger: ["error"] }
    )
    await app.listen(0, "127.0.0.1")
    baseURL = await app.getUrl()
    runtime = app.get(AuthRuntime)
  })
  afterAll(async () => {
    await app?.close()
    await migrator?.end()
    await container?.stop()
  })

  it("rejects anonymous and organization members, then admits only a current assignment", async () => {
    const anonymous = await platformAccess()
    expect(anonymous.status).toBe(401)

    const member = await signup()
    const org = await runtime.auth.api.createOrganization({
      headers: member.headers,
      body: { name: "Member org", slug: randomUUID() },
    })
    const asMember = await platformAccess(member.cookie)
    expect(asMember.status).toBe(403)
    expect(await json(asMember)).toEqual(
      expect.objectContaining({ code: "FORBIDDEN" })
    )

    await runtime.pool.query(
      "INSERT INTO platform_assignment (user_id) VALUES ($1)",
      [member.user.id]
    )
    const allowed = await platformAccess(member.cookie)
    expect(allowed.status).toBe(200)
    expect(await json(allowed)).toEqual({ userId: member.user.id })

    const tenantAccess = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/access`,
      { headers: { cookie: member.cookie } }
    )
    expect(tenantAccess.status).toBe(200)

    await migrator.query("DELETE FROM platform_assignment WHERE user_id = $1", [
      member.user.id,
    ])
    const revoked = await platformAccess(member.cookie)
    expect(revoked.status).toBe(403)
  })

  it("does not let a platform admin call tenant APIs without membership", async () => {
    const admin = await signup()
    await runtime.pool.query(
      "INSERT INTO platform_assignment (user_id) VALUES ($1)",
      [admin.user.id]
    )
    const allowed = await platformAccess(admin.cookie)
    expect(allowed.status).toBe(200)

    const outsider = await signup()
    const org = await runtime.auth.api.createOrganization({
      headers: outsider.headers,
      body: { name: "Other org", slug: randomUUID() },
    })
    const tenantAccess = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/access`,
      { headers: { cookie: admin.cookie } }
    )
    expect(tenantAccess.status).toBe(403)
  })
})
