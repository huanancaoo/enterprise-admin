import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { managePlatformAssignment } from "../../packages/database/dist/platform-assignment-admin.js"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("platform access denial audit", () => {
  let environment
  const origin = "http://localhost:3201"
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
  })
  afterAll(async () => {
    await environment?.close()
  })
  const access = (cookie) =>
    fetch(`${environment.baseURL}/api/v1/me/platform`, {
      headers: cookie ? { cookie } : {},
    })
  const signup = () =>
    signUpVerified(environment.baseURL, origin, environment.migrator)

  async function readAudit(requestId) {
    const client = await environment.migrator.connect()
    try {
      await client.query("BEGIN")
      // 测试迁移身份只在本事务读取落库事实；运行角色的 RLS 和授权断言保持原规则。
      await client.query(
        "CREATE POLICY test_platform_audit_reader ON audit_events FOR SELECT TO app_migrator USING (scope = 'platform')"
      )
      return (
        await client.query(
          "SELECT organization_id, scope, event_code, actor_type, actor_id, result, reason, request_id, tenant_visible, fields FROM audit_events WHERE request_id = $1",
          [requestId]
        )
      ).rows
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
  }

  it("persists anonymous and tenant denials without exposing them to tenant or platform SQL", async () => {
    const anonymous = await access()
    expect(anonymous.status).toBe(401)
    const anonymousBody = await anonymous.json()
    expect(anonymousBody.code).toBe("UNAUTHENTICATED")
    expect(await readAudit(anonymousBody.requestId)).toEqual([
      expect.objectContaining({
        organization_id: null,
        scope: "platform",
        event_code: "platform.access_denied",
        actor_type: "system",
        actor_id: null,
        result: "denied",
        reason: "UNAUTHENTICATED",
        tenant_visible: false,
        fields: {},
      }),
    ])

    const user = await signup()
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: user.headers,
      body: { name: "Denial boundary", slug: randomUUID() },
    })
    const denied = await access(user.cookie)
    expect(denied.status).toBe(403)
    const body = await denied.json()
    expect(body.code).toBe("FORBIDDEN")
    expect(await readAudit(body.requestId)).toEqual([
      expect.objectContaining({
        organization_id: null,
        actor_type: "user",
        actor_id: user.user.id,
        result: "denied",
        reason: "FORBIDDEN",
        tenant_visible: false,
      }),
    ])
    const client = await environment.runtime.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        organization.id,
      ])
      expect(
        (
          await client.query(
            "SELECT id FROM audit_events WHERE request_id = $1",
            [body.requestId]
          )
        ).rows
      ).toEqual([])
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
    await expect(
      environment.platformPool.query("SELECT id FROM audit_events")
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      environment.runtime.pool.query(
        "SELECT record_platform_access_denial($1, $2, $3)",
        [user.user.id, "FORBIDDEN", randomUUID()]
      )
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      environment.platformPool.query(
        "SELECT record_platform_access_denial($1, $2, $3)",
        [user.user.id, "arbitrary.reason", randomUUID()]
      )
    ).rejects.toMatchObject({ code: "22023" })
  })

  it("records a missing session MFA assertion as a separate denial reason", async () => {
    const user = await signup()
    await managePlatformAssignment(environment.deployerPool, "grant", {
      userId: user.user.id,
      role: "platform_admin",
      reason: "denial audit fixture",
    })
    const response = await access(user.cookie)
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.code).toBe("PLATFORM_MFA_REQUIRED")
    expect(await readAudit(body.requestId)).toEqual([
      expect.objectContaining({
        actor_id: user.user.id,
        reason: "PLATFORM_MFA_REQUIRED",
        result: "denied",
      }),
    ])
  })

  it("returns AUDIT_UNAVAILABLE when the denial cannot be persisted", async () => {
    const user = await signup()
    await environment.migrator.query(
      "REVOKE EXECUTE ON FUNCTION record_platform_access_denial(uuid,text,text) FROM platform_runtime"
    )
    try {
      const response = await access(user.cookie)
      expect(response.status).toBe(503)
      const body = await response.json()
      expect(body.code).toBe("AUDIT_UNAVAILABLE")
      expect(await readAudit(body.requestId)).toEqual([])
    } finally {
      await environment.migrator.query(
        "GRANT EXECUTE ON FUNCTION record_platform_access_denial(uuid,text,text) TO platform_runtime"
      )
    }
  })
})
