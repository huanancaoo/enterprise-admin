import { startAuthProbeDatabase } from "../setup/auth-probe-database.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { testEmailConfig } from "../setup/email-config.ts"
import { execFile } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { createRequire } from "node:module"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { createDatabase } from "../../packages/database/dist/index.js"
const databaseRequire = createRequire(
  new URL("../../packages/database/package.json", import.meta.url)
)
const { drizzle } = databaseRequire("drizzle-orm/node-postgres")
const require = createRequire(import.meta.url)
const {
  createApplication,
} = require("../../apps/api/dist/create-application.js")
const { AuthRuntime } = require("../../apps/api/dist/auth-runtime.js")

describe("S8: Organization integration invariants", () => {
  let container, app, runtime, baseURL, migrator
  const origin = "http://localhost:3200"
  const versionedPaths = new Set([
    "organization/update-member-role",
    "organization/update-role",
    "organization/delete-role",
  ])
  const post = async (path, body, cookie) => {
    const headers = {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    }
    if (versionedPaths.has(path)) {
      const version = await migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
        [body.organizationId]
      )
      headers["X-Expected-Authz-Version"] = String(
        version.rows[0].authorization_version
      )
    }
    return fetch(`${baseURL}/api/auth/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
  }
  const signup = () =>
    signUpVerified(baseURL, origin, migrator, { name: "S8 probe" })
  const organization = async (actor) =>
    runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "S8 probe", slug: randomUUID() },
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

  it("documents that a caller transaction does not own the auth lifecycle transaction", async () => {
    const actor = await signup()
    const slug = randomUUID()
    await expect(
      drizzle(runtime.pool).transaction(async () => {
        await runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: { name: "independent", slug },
        })
        throw new Error("injected audit failure")
      })
    ).rejects.toThrow("injected audit failure")
    const result = await migrator.query(
      "SELECT id FROM organization WHERE slug = $1",
      [slug]
    )
    expect(result.rowCount).toBe(1)
  })
  it("native organization reads reject a suspended organization", async () => {
    const actor = await signup()
    const org = await organization(actor)
    await migrator.query(
      "UPDATE organization_status SET status = 'SUSPENDED', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
      [org.id]
    )
    const response = await fetch(
      `${baseURL}/api/auth/organization/get-full-organization?organizationId=${org.id}`,
      { headers: { cookie: actor.cookie } }
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "ORGANIZATION_SUSPENDED",
    })
  })

  it("role deletion rejects active invitation references", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const role = await post(
      "organization/create-role",
      {
        organizationId: org.id,
        role: "reviewer",
        permission: { project: ["read"] },
      },
      actor.cookie
    )
    expect(role.status).toBe(200)
    const invited = await post(
      "organization/invite-member",
      {
        organizationId: org.id,
        email: `${randomUUID()}@example.test`,
        role: "reviewer",
      },
      actor.cookie
    )
    expect(invited.status).toBe(200)
    const removed = await post(
      "organization/delete-role",
      { organizationId: org.id, roleName: "reviewer" },
      actor.cookie
    )
    expect(removed.ok).toBe(false)
    expect(
      (
        await migrator.query(
          "SELECT role FROM invitation WHERE organization_id = $1 AND status = 'pending'",
          [org.id]
        )
      ).rows
    ).toEqual([{ role: "reviewer" }])
    expect(
      (
        await migrator.query(
          "SELECT id FROM organization_role WHERE organization_id = $1",
          [org.id]
        )
      ).rowCount
    ).toBe(1)
  })

  it("session update failure rolls back membership and keeps invitation pending", async () => {
    const owner = await signup()
    const recipient = await signup()
    const org = await organization(owner)
    const invited = await post(
      "organization/invite-member",
      { organizationId: org.id, email: recipient.email, role: "member" },
      owner.cookie
    )
    expect(invited.status).toBe(200)
    const invitation = await invited.json()
    // 真实数据库触发器在后续 Session 写入点失败，观测之前的 Member 写入是否回滚。
    await migrator.query(`CREATE FUNCTION s8_fail_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'S8 injected session failure'; END $$;
      CREATE TRIGGER s8_fail_session BEFORE UPDATE OF active_organization_id ON session FOR EACH ROW EXECUTE FUNCTION s8_fail_session()`)
    try {
      const accepted = await post(
        "organization/accept-invitation",
        { invitationId: invitation.id },
        recipient.cookie
      )
      expect(accepted.status).toBe(500)
      expect(
        (
          await migrator.query(
            "SELECT role FROM member WHERE organization_id = $1 AND user_id = $2",
            [org.id, recipient.user.id]
          )
        ).rows
      ).toEqual([])
      expect(
        (
          await migrator.query("SELECT status FROM invitation WHERE id = $1", [
            invitation.id,
          ])
        ).rows
      ).toEqual([{ status: "pending" }])
    } finally {
      await migrator.query(
        "DROP TRIGGER s8_fail_session ON session; DROP FUNCTION s8_fail_session()"
      )
    }
  })

  it("concurrent owner departures retain one owner", async () => {
    const first = await signup()
    const second = await signup()
    const org = await organization(first)
    await runtime.auth.api.addMember({
      headers: first.headers,
      body: { organizationId: org.id, userId: second.user.id, role: "owner" },
    })
    // 阻塞真实 DELETE，使两个请求均完成 owner 数量检查后才释放；不依赖固定 sleep 猜测竞态。
    const lock = await migrator.connect()
    await lock.query("SELECT pg_advisory_lock(80009)")
    await migrator.query(`CREATE FUNCTION s8_owner_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(80009); RETURN OLD; END $$;
      CREATE TRIGGER s8_owner_barrier BEFORE DELETE ON member FOR EACH ROW EXECUTE FUNCTION s8_owner_barrier()`)
    const requests = Promise.all(
      [first, second].map((actor) =>
        post("organization/leave", { organizationId: org.id }, actor.cookie)
      )
    )
    try {
      await expect
        .poll(
          async () =>
            Number(
              (
                await migrator.query(
                  "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 80009 AND NOT granted"
                )
              ).rows[0].count
            ),
          { timeout: 10000 }
        )
        .toBe(1)
    } finally {
      await lock.query("SELECT pg_advisory_unlock(80009)")
      lock.release()
      await requests
      await migrator.query(
        "DROP TRIGGER s8_owner_barrier ON member; DROP FUNCTION s8_owner_barrier()"
      )
    }
    const statuses = (await requests).map((response) => response.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status !== 200)).toHaveLength(1)
    expect(
      (
        await migrator.query(
          "SELECT id FROM member WHERE organization_id = $1",
          [org.id]
        )
      ).rowCount
    ).toBe(1)
  })
  it("native MFA endpoints are not mounted in the production configuration", async () => {
    const actor = await signup()
    const response = await post(
      "two-factor/verify-totp",
      { code: "000000" },
      actor.cookie
    )
    expect(response.status).toBe(404)
    const session = await runtime.auth.api.getSession({
      headers: actor.headers,
    })
    expect(session.session).not.toHaveProperty("mfaVerified")
    await post("sign-out", {}, actor.cookie)
    expect(
      await runtime.auth.api.getSession({ headers: actor.headers })
    ).toBeNull()
  })
  it("production organization writes record trusted audit context", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const recipient = await signup()
    const member = await runtime.auth.api.addMember({
      headers: actor.headers,
      body: {
        organizationId: org.id,
        userId: recipient.user.id,
        role: "member",
      },
    })
    const response = await post(
      "organization/update-member-role",
      { organizationId: org.id, memberId: member.id, role: "admin" },
      actor.cookie
    )
    expect(response.status).toBe(200)
    expect(
      (
        await migrator.query("SELECT role FROM member WHERE id = $1", [
          member.id,
        ])
      ).rows[0].role
    ).toBe("admin")
    const auditReader = await migrator.connect()
    try {
      await auditReader.query("BEGIN")
      await auditReader.query(
        "SELECT set_config('app.organization_id', $1, true)",
        [org.id]
      )
      expect(
        (
          await auditReader.query(
            `SELECT actor_id, request_id
           FROM audit_events
           WHERE organization_id = $1
             AND resource_id = $2
             AND event_code = 'organization.member.update'`,
            [org.id, member.id]
          )
        ).rows
      ).toEqual([
        expect.objectContaining({
          actor_id: actor.user.id,
          request_id: expect.any(String),
        }),
      ])
    } finally {
      await auditReader.query("ROLLBACK")
      auditReader.release()
    }
  })

  it("member role updates require the current authorization version", async () => {
    const actor = await signup()
    const recipient = await signup()
    const org = await organization(actor)
    const member = await runtime.auth.api.addMember({
      headers: actor.headers,
      body: {
        organizationId: org.id,
        userId: recipient.user.id,
        role: "member",
      },
    })
    const request = (version) =>
      fetch(`${baseURL}/api/auth/organization/update-member-role`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: actor.cookie,
          ...(version === undefined
            ? {}
            : { "X-Expected-Authz-Version": String(version) }),
        },
        body: JSON.stringify({
          organizationId: org.id,
          memberId: member.id,
          role: "admin",
        }),
      })
    expect((await request()).status).toBe(409)
    const current = (
      await migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
        [org.id]
      )
    ).rows[0].authorization_version
    expect((await request(current - 1)).status).toBe(409)
    expect(
      (
        await migrator.query("SELECT role FROM member WHERE id = $1", [
          member.id,
        ])
      ).rows[0].role
    ).toBe("member")
  })

  it("organization deletion commits its cascade and preserves audit history", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const response = await post(
      "organization/delete",
      { organizationId: org.id },
      actor.cookie
    )
    expect(response.status).toBe(200)
    expect(
      (
        await migrator.query("SELECT id FROM organization WHERE id = $1", [
          org.id,
        ])
      ).rowCount
    ).toBe(0)
    const reader = await migrator.connect()
    try {
      await reader.query("BEGIN")
      await reader.query("SELECT set_config('app.organization_id', $1, true)", [
        org.id,
      ])
      expect(
        (
          await reader.query(
            `SELECT actor_id, request_id
             FROM audit_events
             WHERE organization_id = $1
               AND resource_id = $1
               AND event_code = 'organization.organization.delete'`,
            [org.id]
          )
        ).rows
      ).toEqual([
        expect.objectContaining({
          actor_id: actor.user.id,
          request_id: expect.any(String),
        }),
      ])
    } finally {
      await reader.query("ROLLBACK")
      reader.release()
    }
  })

  it("database audit failure in the same statement rolls back the auth mutation", async () => {
    const actor = await signup()
    const org = await organization(actor)
    const recipient = await signup()
    const member = await runtime.auth.api.addMember({
      headers: actor.headers,
      body: {
        organizationId: org.id,
        userId: recipient.user.id,
        role: "member",
      },
    })
    await migrator.query(`CREATE FUNCTION s8_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'S8 injected audit failure'; END $$;
      CREATE TRIGGER s8_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION s8_fail_audit()`)
    try {
      const response = await post(
        "organization/update-member-role",
        { organizationId: org.id, memberId: member.id, role: "admin" },
        actor.cookie
      )
      expect(response.status).toBe(500)
      expect(
        (
          await migrator.query("SELECT role FROM member WHERE id = $1", [
            member.id,
          ])
        ).rows[0].role
      ).toBe("member")
    } finally {
      await migrator.query(
        "DROP TRIGGER s8_fail_audit ON audit_events; DROP FUNCTION s8_fail_audit()"
      )
    }
  })
  it("concurrent invitation acceptance creates one membership and rejects replay", async () => {
    const owner = await signup(),
      recipient = await signup()
    const org = await organization(owner)
    const response = await post(
      "organization/invite-member",
      { organizationId: org.id, email: recipient.email, role: "member" },
      owner.cookie
    )
    expect(response.status).toBe(200)
    const invitation = await response.json()
    const accepted = await Promise.all(
      [1, 2].map(() =>
        post(
          "organization/accept-invitation",
          { invitationId: invitation.id },
          recipient.cookie
        )
      )
    )
    expect(accepted.filter((response) => response.ok)).toHaveLength(1)
    expect(
      (
        await migrator.query(
          "SELECT id FROM member WHERE organization_id = $1 AND user_id = $2",
          [org.id, recipient.user.id]
        )
      ).rowCount
    ).toBe(1)
    expect(
      (
        await post(
          "organization/accept-invitation",
          { invitationId: invitation.id },
          recipient.cookie
        )
      ).ok
    ).toBe(false)
  })

  it("rejects acceptance after the original inviter loses membership", async () => {
    const inviter = await signup()
    const remainingOwner = await signup()
    const recipient = await signup()
    const org = await organization(inviter)
    await runtime.auth.api.addMember({
      headers: inviter.headers,
      body: {
        organizationId: org.id,
        userId: remainingOwner.user.id,
        role: "owner",
      },
    })
    const invitationResponse = await post(
      "organization/invite-member",
      { organizationId: org.id, email: recipient.email, role: "member" },
      inviter.cookie
    )
    expect(invitationResponse.status).toBe(200)
    const invitation = await invitationResponse.json()
    const inviterMembership = (
      await migrator.query(
        "SELECT id FROM member WHERE organization_id = $1 AND user_id = $2",
        [org.id, inviter.user.id]
      )
    ).rows[0]
    expect(
      (
        await post(
          "organization/remove-member",
          {
            organizationId: org.id,
            memberIdOrEmail: inviterMembership.id,
          },
          remainingOwner.cookie
        )
      ).status
    ).toBe(200)
    expect(
      (
        await post(
          "organization/accept-invitation",
          { invitationId: invitation.id },
          recipient.cookie
        )
      ).ok
    ).toBe(false)
    expect(
      (
        await migrator.query(
          "SELECT id FROM member WHERE organization_id = $1 AND user_id = $2",
          [org.id, recipient.user.id]
        )
      ).rowCount
    ).toBe(0)
  })

  it("serializes role deletion against concurrent assignment", async () => {
    const owner = await signup(),
      recipient = await signup()
    const org = await organization(owner)
    const member = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: recipient.user.id,
        role: "member",
      },
    })
    expect(
      (
        await post(
          "organization/create-role",
          {
            organizationId: org.id,
            role: "reviewer",
            permission: { project: ["read"] },
          },
          owner.cookie
        )
      ).status
    ).toBe(200)
    const lock = await migrator.connect()
    let lockReleased = false
    await lock.query("SELECT pg_advisory_lock(80010)")
    await migrator.query(`CREATE FUNCTION s8_role_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(80010); RETURN OLD; END $$;
      CREATE TRIGGER s8_role_barrier BEFORE DELETE ON organization_role FOR EACH ROW EXECUTE FUNCTION s8_role_barrier()`)
    const deletion = post(
      "organization/delete-role",
      { organizationId: org.id, roleName: "reviewer" },
      owner.cookie
    )
    try {
      await expect
        .poll(
          async () =>
            Number(
              (
                await migrator.query(
                  "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND objid = 80010 AND NOT granted"
                )
              ).rows[0].count
            ),
          { timeout: 10000 }
        )
        .toBe(1)
      const assignment = post(
        "organization/update-member-role",
        { organizationId: org.id, memberId: member.id, role: "reviewer" },
        owner.cookie
      )
      await lock.query("SELECT pg_advisory_unlock(80010)")
      lock.release()
      lockReleased = true
      const [deletionResponse, assignmentResponse] = await Promise.all([
        deletion,
        assignment,
      ])
      expect(deletionResponse.status).toBe(200)
      expect(assignmentResponse.ok).toBe(false)
    } finally {
      if (!lockReleased) {
        await lock.query("SELECT pg_advisory_unlock(80010)")
        lock.release()
      }
      await migrator.query(
        "DROP TRIGGER s8_role_barrier ON organization_role; DROP FUNCTION s8_role_barrier()"
      )
    }
    expect(
      (
        await migrator.query("SELECT role FROM member WHERE id = $1", [
          member.id,
        ])
      ).rows[0].role
    ).toBe("member")
    expect(
      (
        await migrator.query(
          "SELECT id FROM organization_role WHERE organization_id = $1",
          [org.id]
        )
      ).rowCount
    ).toBe(0)
  })
})
