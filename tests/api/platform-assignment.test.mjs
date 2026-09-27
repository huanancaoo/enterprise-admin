import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { execFile } from "node:child_process"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { beforeAll, afterAll, describe, expect, it } from "vitest"

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  let bits = ""
  for (const character of value.toUpperCase().replace(/=+$/, "")) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0")
  }
  const bytes = []
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2))
  }
  return Buffer.from(bytes)
}

function totp(secret, now = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counter)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return value.toString().padStart(6, "0")
}

describe("platform assignment access boundary", () => {
  let environment
  let runtime, migrator, baseURL
  const origin = "http://localhost:3201"
  const signup = () =>
    signUpVerified(baseURL, origin, migrator, { name: "Platform test" })
  const json = (response) => response.json()
  const platformAccess = (cookie) =>
    fetch(`${baseURL}/api/v1/me/platform`, {
      headers: cookie ? { cookie } : {},
    })
  const setCookies = (response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
  const cli = async (action, userId, role, reason) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "apps/api/dist/console.js",
        "platform",
        "assignment",
        action,
        "--user-id",
        userId,
        "--role",
        role,
        "--reason",
        reason,
      ],
      {
        env: {
          PATH: process.env.PATH,
          PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
        },
      }
    )
    return stdout.trim()
  }
  const fetchJson = (path, body, cookie) =>
    fetch(`${baseURL}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    })
  const getSession = (cookie) =>
    fetch(`${baseURL}/api/auth/get-session`, {
      headers: { origin, cookie },
    })

  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    ;({ runtime, migrator, baseURL } = environment)
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("deployment CLI grants only verified users and writes a transactional audit", async () => {
    const member = await signup()
    expect(
      await cli(
        "grant",
        member.user.id,
        "platform_auditor",
        "issue 19 verified target"
      )
    ).toBe(`grant ${member.user.id} platform_auditor`)
    const record = await migrator.query(
      "SELECT role, status, granted_by, grant_reason FROM platform_assignment WHERE user_id = $1",
      [member.user.id]
    )
    expect(record.rows[0]).toMatchObject({
      role: "platform_auditor",
      status: "active",
      granted_by: "platform_deployer",
      grant_reason: "issue 19 verified target",
    })
    const audit = await migrator.query(
      "SELECT action, result, reason, actor FROM platform_assignment_audit WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
      [member.user.id]
    )
    expect(audit.rows[0]).toMatchObject({
      action: "grant",
      result: "changed",
      reason: "issue 19 verified target",
      actor: "platform_deployer",
    })
    await cli("grant", member.user.id, "platform_auditor", "repeat assignment")
    await cli("grant", member.user.id, "platform_admin", "role change")
    await cli("revoke", member.user.id, "platform_admin", "end assignment")
    await cli("revoke", member.user.id, "platform_admin", "repeat revocation")
    const history = await migrator.query(
      "SELECT action, result FROM platform_assignment_audit WHERE user_id = $1 ORDER BY created_at, id",
      [member.user.id]
    )
    expect(history.rows.map((item) => item.result)).toEqual([
      "changed",
      "no_change",
      "changed",
      "changed",
      "no_change",
    ])
    expect((await platformAccess(member.cookie)).status).toBe(403)

    const unverified = await runtime.auth.api.signUpEmail({
      body: {
        name: "Unverified",
        email: `${randomUUID()}@example.test`,
        password: randomBytes(24).toString("hex"),
      },
    })
    await expect(
      cli("grant", unverified.user.id, "platform_admin", "should fail")
    ).rejects.toMatchObject({ code: 1 })
    const notGranted = await migrator.query(
      "SELECT 1 FROM platform_assignment WHERE user_id = $1",
      [unverified.user.id]
    )
    expect(notGranted.rowCount).toBe(0)
  })

  it("requires a TOTP assertion bound to the active session and rejects bad codes", async () => {
    const member = await signup()
    await cli(
      "grant",
      member.user.id,
      "platform_admin",
      "verified platform operator"
    )
    const initiallyDenied = await platformAccess(member.cookie)
    expect(initiallyDenied.status).toBe(403)
    expect(await json(initiallyDenied)).toMatchObject({
      code: "PLATFORM_MFA_REQUIRED",
    })

    const previousSession = await getSession(member.cookie).then((response) =>
      response.json()
    )
    const enabled = await fetchJson(
      "two-factor/enable",
      { password: member.password, method: "totp", issuer: "Enterprise Admin" },
      member.cookie
    )
    expect(enabled.status).toBe(200)
    const enabledData = await json(enabled)
    const setupSessionCookie = setCookies(enabled) || member.cookie
    const sessionAfterEnable = await getSession(setupSessionCookie)
    expect(sessionAfterEnable.status).toBe(200)
    expect((await sessionAfterEnable.json()).session.id).toBe(
      previousSession.session.id
    )
    const totpSecret = new URL(enabledData.totpURI).searchParams.get("secret")
    expect(totpSecret).toBeTruthy()

    const badCodeValue = totp(totpSecret) === "000000" ? "000001" : "000000"
    const badCode = await fetchJson(
      "two-factor/verify-totp",
      { code: badCodeValue },
      setupSessionCookie
    )
    expect(badCode.status).toBe(401)
    expect(await json(badCode)).toMatchObject({ code: "INVALID_CODE" })
    expect(
      await migrator.query(
        "SELECT 1 FROM platform_session_assurance WHERE user_id = $1",
        [member.user.id]
      )
    ).toMatchObject({ rowCount: 0 })
    const stillDenied = await platformAccess(setupSessionCookie)
    expect(await json(stillDenied)).toMatchObject({
      code: "PLATFORM_MFA_REQUIRED",
    })

    const verified = await fetchJson(
      "two-factor/verify-totp",
      { code: totp(totpSecret) },
      setupSessionCookie
    )
    expect(verified.status).toBe(200)
    const verifiedSessionCookie = setCookies(verified) || setupSessionCookie
    const verifiedSession = await getSession(verifiedSessionCookie).then(
      (response) => response.json()
    )
    expect(verifiedSession.session.id).not.toBe(previousSession.session.id)
    expect(
      await getSession(setupSessionCookie).then((response) => response.json())
    ).toBeNull()
    expect((await platformAccess(setupSessionCookie)).status).toBe(401)
    const assurance = await migrator.query(
      "SELECT session_id, method FROM platform_session_assurance WHERE user_id = $1",
      [member.user.id]
    )
    expect(assurance.rows).toEqual([
      expect.objectContaining({ method: "totp" }),
    ])
    const allowed = await platformAccess(verifiedSessionCookie)
    expect(allowed.status).toBe(200)
    expect(await json(allowed)).toMatchObject({
      userId: member.user.id,
      role: "platform_admin",
      scope: "global",
      mfaVerifiedAt: expect.any(String),
    })

    const other = await signup()
    const org = await runtime.auth.api.createOrganization({
      headers: other.headers,
      body: { name: "Other user's organization", slug: randomUUID() },
    })
    expect(org.id).toBeTruthy()
    expect(
      (
        await migrator.query("SELECT 1 FROM member WHERE user_id = $1", [
          member.user.id,
        ])
      ).rowCount
    ).toBe(0)
    const tenantProjects = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      { headers: { cookie: verifiedSessionCookie } }
    )
    expect(tenantProjects.status).toBe(403)
    const revoked = await cli(
      "revoke",
      member.user.id,
      "platform_admin",
      "remove platform assignment"
    )
    expect(revoked).toBe(`revoke ${member.user.id} platform_admin`)
    expect((await platformAccess(verifiedSessionCookie)).status).toBe(403)
    const tenantApi = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/access`,
      { headers: { cookie: verifiedSessionCookie } }
    )
    expect(tenantApi.status).toBe(403)
    const signedOut = await fetchJson("sign-out", {}, verifiedSessionCookie)
    expect(signedOut.status).toBe(200)
    expect((await platformAccess(verifiedSessionCookie)).status).toBe(401)
  })

  it("rejects an expired session after valid MFA-backed platform access", async () => {
    const user = await signup()
    await cli(
      "grant",
      user.user.id,
      "platform_admin",
      "expired platform session"
    )
    const enabled = await fetchJson(
      "two-factor/enable",
      { password: user.password, method: "totp", issuer: "Enterprise Admin" },
      user.cookie
    )
    expect(enabled.status).toBe(200)
    const enabledData = await json(enabled)
    const setupSessionCookie = setCookies(enabled) || user.cookie
    const totpSecret = new URL(enabledData.totpURI).searchParams.get("secret")
    expect(totpSecret).toBeTruthy()

    const verified = await fetchJson(
      "two-factor/verify-totp",
      { code: totp(totpSecret) },
      setupSessionCookie
    )
    expect(verified.status).toBe(200)
    const verifiedSessionCookie = setCookies(verified) || setupSessionCookie
    const session = await getSession(verifiedSessionCookie).then((response) =>
      response.json()
    )

    const activeDatabaseAccess = await environment.platformPool.query(
      "SELECT * FROM public.read_platform_access($1, $2)",
      [user.user.id, session.session.id]
    )
    expect(activeDatabaseAccess.rows).toEqual([
      expect.objectContaining({
        role: "platform_admin",
        two_factor_enabled: true,
        mfa_verified_at: expect.any(Date),
      }),
    ])
    expect((await platformAccess(verifiedSessionCookie)).status).toBe(200)

    await migrator.query(
      "UPDATE public.session SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
      [session.session.id]
    )
    const persistedExpiry = await migrator.query(
      "SELECT expires_at < clock_timestamp() AS expired FROM public.session WHERE id = $1",
      [session.session.id]
    )
    expect(persistedExpiry.rows[0].expired).toBe(true)

    const databaseAccess = await environment.platformPool.query(
      "SELECT * FROM public.read_platform_access($1, $2)",
      [user.user.id, session.session.id]
    )
    expect(databaseAccess.rowCount).toBe(0)
    const expiredPlatformAccess = await platformAccess(verifiedSessionCookie)
    expect(expiredPlatformAccess.status).toBe(403)
    expect(await json(expiredPlatformAccess)).toMatchObject({
      code: "FORBIDDEN",
    })
  })

  it("does not let tenant owners or admins grant themselves platform access over HTTP", async () => {
    const owner = await signup()
    const admin = await signup()
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Tenant role boundary", slug: randomUUID() },
    })
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: admin.user.id,
        role: "admin",
      },
    })

    const tenantRoles = await migrator.query(
      "SELECT user_id, role FROM member WHERE organization_id = $1 AND user_id IN ($2, $3) ORDER BY role",
      [org.id, owner.user.id, admin.user.id]
    )
    expect(tenantRoles.rows).toEqual([
      { user_id: admin.user.id, role: "admin" },
      { user_id: owner.user.id, role: "owner" },
    ])

    for (const tenant of [owner, admin]) {
      const attemptedGrant = await fetch(`${baseURL}/api/v1/me/platform`, {
        method: "POST",
        headers: {
          cookie: tenant.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: tenant.user.id,
          role: "platform_admin",
        }),
      })
      expect([404, 405]).toContain(attemptedGrant.status)
    }

    const assignments = await migrator.query(
      "SELECT user_id FROM platform_assignment WHERE user_id IN ($1, $2)",
      [owner.user.id, admin.user.id]
    )
    expect(assignments.rowCount).toBe(0)
  })

  it("keeps platform identity independent of organization membership and app_runtime grants", async () => {
    const user = await signup()
    await expect(
      runtime.pool.query("SELECT * FROM platform_assignment")
    ).rejects.toMatchObject({
      code: "42501",
    })
    await expect(
      environment.platformPool.query("SELECT * FROM platform_assignment")
    ).rejects.toMatchObject({
      code: "42501",
    })
    await expect(
      runtime.pool.query("SELECT public.read_platform_access($1, $2)", [
        user.user.id,
        randomUUID(),
      ])
    ).rejects.toMatchObject({
      code: "42501",
    })
    expect(
      (
        await environment.platformPool.query(
          "SELECT * FROM public.read_platform_access($1, $2)",
          [user.user.id, randomUUID()]
        )
      ).rowCount
    ).toBe(0)
    const attemptedHttpGrant = await fetch(`${baseURL}/api/v1/me/platform`, {
      method: "POST",
      headers: { cookie: user.cookie, "content-type": "application/json" },
      body: JSON.stringify({ userId: user.user.id, role: "platform_admin" }),
    })
    expect([404, 405]).toContain(attemptedHttpGrant.status)
    expect((await platformAccess(user.cookie)).status).toBe(403)
  })
})
