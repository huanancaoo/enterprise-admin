import { startAuthProbeDatabase } from "../setup/auth-probe-database.mjs"
import { randomBytes, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { createDatabase } from "../../packages/database/dist/index.js"
const require = createRequire(
  new URL("../../packages/database/package.json", import.meta.url)
)
const { betterAuth } = require("better-auth")
const { twoFactor, magicLink } = require("better-auth/plugins")
const { getMigrations } = require("better-auth/db/migration")

// 独立插件实验：验证 1.7.5 的会话行为，不代表生产 Drizzle 集成已完成。
describe("S8-00: 2FA plugin session evidence (isolated PostgreSQL adapter)", () => {
  let container, migrator, pool, auth, deliveredOTP, deliveredLink
  const origin = "http://localhost:3200"
  const request = (path, body, cookie = "") =>
    auth.handler(
      new Request(`${origin}/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: { origin, "content-type": "application/json", cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    )
  const cookies = (response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
  beforeAll(async () => {
    const database = await startAuthProbeDatabase()
    container = database.container
    const { url, passwords } = database
    const bootstrap = createDatabase(url("bootstrap_admin", passwords[0])).pool
    try {
      await bootstrap.query("CREATE DATABASE mfa_probe OWNER app_migrator")
    } finally {
      await bootstrap.end()
    }
    migrator = createDatabase(
      url("app_migrator", passwords[1]).replace(
        "/enterprise_admin",
        "/mfa_probe"
      )
    ).pool
    pool = createDatabase(
      url("app_runtime", passwords[2]).replace(
        "/enterprise_admin",
        "/mfa_probe"
      )
    ).pool
    const options = {
      baseURL: origin,
      basePath: "/api/auth",
      secret: randomBytes(32).toString("hex"),
      database: migrator,
      emailAndPassword: { enabled: true },
      advanced: {
        database: { generateId: "uuid" },
        disableOriginCheck: false,
        disableCSRFCheck: false,
      },
      plugins: [
        magicLink({
          sendMagicLink: async ({ url }) => {
            deliveredLink = url
          },
        }),
        twoFactor({
          otpOptions: {
            sendOTP: async ({ otp }) => {
              deliveredOTP = otp
            },
          },
        }),
      ],
    }
    // 仅临时插件实验库使用上游生成器；生产仍只有项目 Drizzle 迁移链。
    await (await getMigrations(options)).runMigrations()
    await migrator.query(
      "GRANT USAGE ON SCHEMA public TO app_runtime; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime"
    )
    auth = betterAuth({ ...options, database: pool })
  })
  afterAll(async () => {
    await pool?.end()
    await migrator?.end()
    await container?.stop()
  })

  it("enabled flag, fresh factor, trusted device and logout have distinct session facts", async () => {
    const email = `${randomUUID()}@example.test`,
      password = randomBytes(24).toString("hex")
    const registered = await request("sign-up/email", {
      email,
      password,
      name: "MFA probe",
    })
    expect(registered.status).toBe(200)
    let cookie = cookies(registered)
    const initial = await (await request("get-session", null, cookie)).json()
    const enabled = await request(
      "two-factor/enable",
      { password, method: "otp" },
      cookie
    )
    expect(enabled.status).toBe(200)
    cookie = cookies(enabled) || cookie
    const signedIn = await (await request("get-session", null, cookie)).json()
    expect(signedIn.user.twoFactorEnabled).toBe(true)
    expect(signedIn.session).not.toHaveProperty("verifiedAt")
    expect(signedIn.session.id).not.toBe(initial.session.id)
    expect(
      await (await request("get-session", null, cookies(registered))).json()
    ).toBeNull()
    await request("sign-out", {}, cookie)

    const challenge = await request("sign-in/email", { email, password })
    expect(challenge.status).toBe(200)
    expect((await challenge.json()).twoFactorRedirect).toBe(true)
    cookie = cookies(challenge)
    expect(await (await request("get-session", null, cookie)).json()).toBeNull()
    expect((await request("two-factor/send-otp", {}, cookie)).status).toBe(200)
    const wrong = await request(
      "two-factor/verify-otp",
      { code: "not-the-code" },
      cookie
    )
    expect(wrong.ok).toBe(false)
    const verified = await request(
      "two-factor/verify-otp",
      { code: deliveredOTP, trustDevice: true },
      cookie
    )
    expect(verified.status).toBe(200)
    const verifiedCookies = cookies(verified)
    const session = await (
      await request("get-session", null, verifiedCookies)
    ).json()
    expect(session.session.id).toBeTruthy()
    expect(session.session).not.toHaveProperty("verifiedAt")
    const trustedCookie = verifiedCookies
      .split("; ")
      .filter((value) => value.includes("trust_device"))
      .join("; ")
    expect(trustedCookie).not.toBe("")
    await request("sign-out", {}, verifiedCookies)
    expect(
      await (await request("get-session", null, verifiedCookies)).json()
    ).toBeNull()
    const trusted = await request(
      "sign-in/email",
      { email, password },
      trustedCookie
    )
    expect(trusted.status).toBe(200)
    expect((await trusted.json()).twoFactorRedirect).not.toBe(true)
    const trustedSession = await (
      await request("get-session", null, cookies(trusted))
    ).json()
    expect(trustedSession.session.id).not.toBe(session.session.id)
    expect(trustedSession.session).not.toHaveProperty("verifiedAt")
    // 第二种登录方式独立验证：2FA 密码拦截器不能代表所有身份入口。
    await request("sign-out", {}, cookies(trusted))
    expect((await request("sign-in/magic-link", { email })).status).toBe(200)
    const magicSignedIn = await auth.handler(new Request(deliveredLink))
    expect(magicSignedIn.status).toBe(302)
    const magicSession = await (
      await request("get-session", null, cookies(magicSignedIn))
    ).json()
    expect(magicSession.user.twoFactorEnabled).toBe(true)
    expect(magicSession.session.id).not.toBe(trustedSession.session.id)
    expect(magicSession.session).not.toHaveProperty("verifiedAt")

    // 已有 Session 的显式验证不轮换 Session，assurance 必须绑定返回的实际身份。
    const magicCookies = cookies(magicSignedIn)
    expect(
      (await request("two-factor/send-otp", {}, magicCookies)).status
    ).toBe(200)
    expect(
      (
        await request(
          "two-factor/verify-otp",
          { code: deliveredOTP },
          magicCookies
        )
      ).status
    ).toBe(200)
    expect(
      (await (await request("get-session", null, magicCookies)).json()).session
        .id
    ).toBe(magicSession.session.id)
  })
})
