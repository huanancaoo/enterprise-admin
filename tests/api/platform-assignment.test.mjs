import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { beforeAll, afterAll, describe, expect, it } from "vitest"

describe("platform assignment access boundary", () => {
  let environment
  let runtime, migrator, baseURL
  const origin = "http://localhost:3201"
  const signup = () =>
    signUpVerified(baseURL, origin, migrator, { name: "Member" })
  const json = (response) => response.json()
  const platformAccess = (cookie) =>
    fetch(`${baseURL}/api/v1/me/platform`, {
      headers: cookie ? { cookie } : {},
    })

  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    ;({ runtime, migrator, baseURL } = environment)
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("真实 CLI 不需要邮件配置即可创建可登录的平台管理员", async () => {
    const email = `${randomUUID()}@example.test`
    const password = randomBytes(24).toString("hex")
    const config = environment.config
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "apps/api/dist/console.js",
        "platform",
        "admin",
        "create",
        "--email",
        email,
        "--password",
        password,
        "--name",
        "CLI 管理员",
      ],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: config.databaseURL,
          BETTER_AUTH_URL: config.baseURL,
          BETTER_AUTH_SECRET: config.secret,
          BETTER_AUTH_TRUSTED_ORIGINS: origin,
        },
      }
    )
    expect(stdout).toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/)
    const login = await fetch(`${baseURL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    expect((await platformAccess(cookie)).status).toBe(200)
    const organizations = await fetch(`${baseURL}/api/v1/me/organizations`, {
      headers: { cookie },
    })
    expect(await organizations.json()).toEqual([])
    const messages = await migrator.query(
      "SELECT count(*)::int AS count FROM email_messages"
    )
    expect(messages.rows[0].count).toBe(0)
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
