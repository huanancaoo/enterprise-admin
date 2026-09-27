import { createRequire } from "node:module"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { randomUUID } from "node:crypto"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
const databaseRequire = createRequire(
  new URL("../../packages/database/package.json", import.meta.url)
)
const { drizzle } = databaseRequire("drizzle-orm/node-postgres")

describe("S8: Organization integration invariants", () => {
  let environment
  let runtime, baseURL, migrator
  const origin = "http://localhost:3200"
  const versionedPaths = new Set([
    "organization/update-member-role",
    "organization/remove-member",
    "organization/leave",
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
  const authorizationVersion = async (organizationId) =>
    (
      await migrator.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id = $1",
        [organizationId]
      )
    ).rows[0].authorization_version
  const versionHeaders = async (actor, organizationId) => {
    const headers = new Headers(actor.headers)
    headers.set(
      "X-Expected-Authz-Version",
      String(await authorizationVersion(organizationId))
    )
    return headers
  }
  const memberAudit = async (organizationId, memberId) => {
    const reader = await migrator.connect()
    try {
      await reader.query("BEGIN")
      await reader.query("SELECT set_config('app.organization_id', $1, true)", [
        organizationId,
      ])
      return (
        await reader.query(
          `SELECT event_code, actor_id, request_id, fields FROM audit_events
           WHERE organization_id = $1 AND resource_id = $2
             AND event_code IN ('member.role_changed', 'member.removed', 'member.left')
           ORDER BY occurred_at, id`,
          [organizationId, memberId]
        )
      ).rows
    } finally {
      await reader.query("ROLLBACK")
      reader.release()
    }
  }
  const roleAudit = async (organizationId, roleId) => {
    const reader = await migrator.connect()
    try {
      await reader.query("BEGIN")
      await reader.query("SELECT set_config('app.organization_id', $1, true)", [
        organizationId,
      ])
      return (
        await reader.query(
          `SELECT event_code, actor_id, request_id, fields FROM audit_events
           WHERE organization_id = $1 AND resource_id = $2
           ORDER BY occurred_at, id`,
          [organizationId, roleId]
        )
      ).rows
    } finally {
      await reader.query("ROLLBACK")
      reader.release()
    }
  }
  const signup = () =>
    signUpVerified(baseURL, origin, migrator, { name: "S8 probe" })
  const organization = async (actor) =>
    runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "S8 probe", slug: randomUUID() },
    })
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    ;({ runtime, migrator, baseURL } = environment)
  })
  afterAll(async () => {
    await environment?.close()
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

  it("creates and lists delegated roles, assigns them through the native member API, and audits creation", async () => {
    const owner = await signup()
    const member = await signup()
    const org = await organization(owner)
    const body = {
      organizationId: org.id,
      role: "project-reader",
      permission: { project: ["read"], member: ["read"] },
    }

    const invalidNames = [
      "ab",
      "Project-reader",
      "owner",
      "platform-admin",
      "comma,role",
    ]
    for (const role of invalidNames) {
      const rejected = await post(
        "organization/create-role",
        { ...body, role },
        owner.cookie
      )
      expect(rejected.status).toBe(400)
      expect((await rejected.json()).code).toBe("ROLE_NAME_INVALID")
    }

    for (const permission of [
      { ac: ["create"] },
      { tenantSettings: ["update"] },
      { platform: ["organization:read"] },
    ]) {
      const rejected = await post(
        "organization/create-role",
        { ...body, role: "blocked-role", permission },
        owner.cookie
      )
      expect(rejected.ok).toBe(false)
    }

    const accessControlReader = await post(
      "organization/create-role",
      {
        organizationId: org.id,
        role: "ac-reader",
        permission: { ac: ["read"] },
      },
      owner.cookie
    )
    expect(accessControlReader.status).toBe(400)
    expect((await accessControlReader.json()).code).toBe(
      "ROLE_PERMISSION_NOT_DELEGABLE"
    )

    await expect(
      runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: {
          organizationId: org.id,
          role: "internal-ac-reader",
          permission: { ac: ["read"] },
        },
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "ROLE_PERMISSION_NOT_DELEGABLE" },
    })

    for (const [role, permission] of [
      ["settings-reader", { tenantSettings: ["read"] }],
      ["audit-reader", { audit: ["read"] }],
    ]) {
      const delegated = await post(
        "organization/create-role",
        { ...body, role, permission },
        owner.cookie
      )
      expect(delegated.status).toBe(200)
    }

    const created = await post("organization/create-role", body, owner.cookie)
    expect(created.status).toBe(200)
    const roleData = (await created.json()).roleData
    expect(roleData).toMatchObject({
      role: "project-reader",
      permission: body.permission,
    })

    const listed = await fetch(
      `${baseURL}/api/auth/organization/list-roles?organizationId=${org.id}`,
      { headers: { cookie: owner.cookie } }
    )
    expect(listed.status).toBe(200)
    expect((await listed.json()).map((role) => role.role)).toContain(
      "project-reader"
    )

    const renamed = await post(
      "organization/update-role",
      {
        organizationId: org.id,
        roleName: "project-reader",
        data: { roleName: "renamed-reader" },
      },
      owner.cookie
    )
    expect(renamed.status).toBe(400)
    expect((await renamed.json()).code).toBe("ROLE_KEY_IMMUTABLE")

    await expect(
      runtime.auth.api.updateOrgRole({
        headers: await versionHeaders(owner, org.id),
        body: {
          organizationId: org.id,
          roleName: "project-reader",
          data: { roleName: "internal-renamed-reader" },
        },
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "ROLE_KEY_IMMUTABLE" },
    })

    const widened = await post(
      "organization/update-role",
      {
        organizationId: org.id,
        roleName: "project-reader",
        data: { permission: { ac: ["create"] } },
      },
      owner.cookie
    )
    expect(widened.status).toBe(400)
    expect((await widened.json()).code).toBe("ROLE_PERMISSION_NOT_DELEGABLE")

    const stillNamed = await fetch(
      `${baseURL}/api/auth/organization/list-roles?organizationId=${org.id}`,
      { headers: { cookie: owner.cookie } }
    )
    expect((await stillNamed.json()).map((role) => role.role)).toContain(
      "project-reader"
    )

    for (const builtInRole of ["owner", "admin", "member"]) {
      const builtInUpdate = await post(
        "organization/update-role",
        {
          organizationId: org.id,
          roleName: builtInRole,
          data: { permission: { project: ["read"] } },
        },
        owner.cookie
      )
      expect(builtInUpdate.ok).toBe(false)
    }

    const nonDelegableUpdate = await post(
      "organization/update-role",
      {
        organizationId: org.id,
        roleName: "project-reader",
        data: { permission: { tenantSettings: ["update"] } },
      },
      owner.cookie
    )
    expect(nonDelegableUpdate.status).toBe(400)
    expect((await nonDelegableUpdate.json()).code).toBe(
      "ROLE_PERMISSION_NOT_DELEGABLE"
    )

    const duplicate = await post("organization/create-role", body, owner.cookie)
    expect(duplicate.ok).toBe(false)
    const sameNameInOtherOrganization = await organization(owner)
    const otherOrganizationRole = await post(
      "organization/create-role",
      { ...body, organizationId: sameNameInOtherOrganization.id },
      owner.cookie
    )
    expect(otherOrganizationRole.status).toBe(200)

    const memberRow = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: member.user.id, role: "member" },
    })
    await post(
      "organization/update-member-role",
      {
        organizationId: org.id,
        memberId: memberRow.id,
        role: "project-reader",
      },
      owner.cookie
    ).then(async (response) => expect(response.status).toBe(200))
    const permissionCheck = await post(
      "organization/has-permission",
      { organizationId: org.id, permissions: { project: ["read"] } },
      member.cookie
    )
    expect(await permissionCheck.json()).toMatchObject({ success: true })

    const audit = await roleAudit(org.id, roleData.id)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      event_code: "role.created",
      actor_id: owner.user.id,
      fields: { role: "project-reader", permission: body.permission },
    })
    expect(audit[0].request_id).toBeTruthy()

    const visibleAudit = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/audit-events?eventCode=role.created`,
      { headers: { cookie: owner.cookie } }
    )
    expect(visibleAudit.status).toBe(200)
    expect((await visibleAudit.json()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventCode: "role.created",
          scope: "tenant",
          actorId: owner.user.id,
          resourceId: roleData.id,
        }),
      ])
    )
  })

  it("intersects the delegated permission catalog with the actor's current permissions", async () => {
    const owner = await signup()
    const manager = await signup()
    const org = await organization(owner)
    const managerRole = "project-reader-manager"
    await migrator.query(
      `INSERT INTO organization_role (organization_id, role, permission)
       VALUES ($1, $2, $3)`,
      [
        org.id,
        managerRole,
        JSON.stringify({ ac: ["create", "read", "update"], project: ["read"] }),
      ]
    )
    const member = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: manager.user.id, role: "member" },
    })
    const promoted = await runtime.auth.api.updateMemberRole({
      headers: await versionHeaders(owner, org.id),
      body: { organizationId: org.id, memberId: member.id, role: managerRole },
    })
    expect(promoted.role).toBe(managerRole)

    const ownerCreatedRole = await post(
      "organization/create-role",
      {
        organizationId: org.id,
        role: "project-reader",
        permission: { project: ["read"] },
      },
      owner.cookie
    )
    expect(ownerCreatedRole.status).toBe(200)

    const deniedUpdate = await post(
      "organization/update-role",
      {
        organizationId: org.id,
        roleName: "project-reader",
        data: { permission: { project: ["delete"] } },
      },
      manager.cookie
    )
    expect(deniedUpdate.ok).toBe(false)

    const allowedUpdate = await post(
      "organization/update-role",
      {
        organizationId: org.id,
        roleName: "project-reader",
        data: { permission: { project: ["read"] } },
      },
      manager.cookie
    )
    expect(allowedUpdate.status).toBe(200)

    const denied = await post(
      "organization/create-role",
      {
        organizationId: org.id,
        role: "project-deleter",
        permission: { project: ["delete"] },
      },
      manager.cookie
    )
    expect(denied.ok).toBe(false)

    const allowed = await post(
      "organization/create-role",
      {
        organizationId: org.id,
        role: "manager-reader",
        permission: { project: ["read"] },
      },
      manager.cookie
    )
    expect(allowed.status).toBe(200)
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

  it.each(["leave", "demote"])(
    "concurrent owner %s operations retain one owner",
    async (action) => {
      const first = await signup()
      const second = await signup()
      const org = await organization(first)
      const secondMember = await runtime.auth.api.addMember({
        headers: first.headers,
        body: {
          organizationId: org.id,
          userId: second.user.id,
          role: "member",
        },
      })
      await runtime.auth.api.updateMemberRole({
        headers: await versionHeaders(first, org.id),
        body: {
          organizationId: org.id,
          memberId: secondMember.id,
          role: "owner",
        },
      })
      const memberships = (
        await migrator.query(
          "SELECT id, user_id FROM member WHERE organization_id = $1",
          [org.id]
        )
      ).rows
      // 第一笔写在持有组织锁时暂停，第二笔必须等待；不使用固定 sleep 猜测竞态。
      const lock = await migrator.connect()
      await lock.query("SELECT pg_advisory_lock(80009)")
      await migrator.query(`CREATE FUNCTION s8_owner_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(80009); RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END $$;
      CREATE TRIGGER s8_owner_barrier BEFORE UPDATE OR DELETE ON member FOR EACH ROW EXECUTE FUNCTION s8_owner_barrier()`)
      const requests = Promise.all(
        [first, second].map((actor) =>
          action === "leave"
            ? post(
                "organization/leave",
                { organizationId: org.id },
                actor.cookie
              )
            : post(
                "organization/update-member-role",
                {
                  organizationId: org.id,
                  memberId: memberships.find(
                    (member) => member.user_id === actor.user.id
                  ).id,
                  role: "member",
                },
                actor.cookie
              )
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
      expect(statuses.filter((status) => status === 409)).toHaveLength(1)
      const failure = (await requests).find(
        (response) => response.status === 409
      )
      expect([
        "LAST_OWNER_REQUIRED",
        "AUTHORIZATION_VERSION_CONFLICT",
      ]).toContain((await failure.json()).code)
      expect(
        (
          await migrator.query(
            "SELECT id FROM member WHERE organization_id = $1 AND role = 'owner'",
            [org.id]
          )
        ).rowCount
      ).toBe(1)
      expect(
        (
          await migrator.query(
            "SELECT id FROM member WHERE organization_id = $1",
            [org.id]
          )
        ).rowCount
      ).toBe(action === "leave" ? 1 : 2)
    }
  )
  it("native MFA endpoints are mounted without session assurance leakage", async () => {
    const actor = await signup()
    const response = await post(
      "two-factor/verify-totp",
      { code: "000000" },
      actor.cookie
    )
    expect(response.status).toBe(400)
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
             AND event_code = 'member.role_changed'`,
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

  it.each(["update-member-role", "remove-member", "leave"])(
    "%s requires the current authorization version over HTTP",
    async (action) => {
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
      const body =
        action === "update-member-role"
          ? { organizationId: org.id, memberId: member.id, role: "admin" }
          : action === "remove-member"
            ? { organizationId: org.id, memberIdOrEmail: member.id }
            : { organizationId: org.id }
      const acting = action === "leave" ? recipient : actor
      const request = (version) =>
        fetch(`${baseURL}/api/auth/organization/${action}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            cookie: acting.cookie,
            ...(version === undefined
              ? {}
              : { "X-Expected-Authz-Version": String(version) }),
          },
          body: JSON.stringify(body),
        })
      const current = await authorizationVersion(org.id)
      for (const version of [undefined, current - 1]) {
        const response = await request(version)
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({
          code: "AUTHORIZATION_VERSION_CONFLICT",
        })
      }
      expect(
        (
          await migrator.query("SELECT role FROM member WHERE id = $1", [
            member.id,
          ])
        ).rows
      ).toEqual([{ role: "member" }])
      expect(await authorizationVersion(org.id)).toBe(current)
      expect(await memberAudit(org.id, member.id)).toEqual([])
      expect((await request(current)).status).toBe(200)
      expect(await authorizationVersion(org.id)).toBe(current + 1)
    }
  )

  it.each([
    ["updateMemberRole", "member.role_changed"],
    ["removeMember", "member.removed"],
    ["leaveOrganization", "member.left"],
  ])(
    "internal auth.api.%s enforces the same version and audit contract",
    async (method, eventCode) => {
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
      const acting = method === "leaveOrganization" ? recipient : actor
      const body =
        method === "updateMemberRole"
          ? { organizationId: org.id, memberId: member.id, role: "admin" }
          : method === "removeMember"
            ? { organizationId: org.id, memberIdOrEmail: member.id }
            : { organizationId: org.id }
      const version = await authorizationVersion(org.id)
      await expect(
        runtime.auth.api[method]({ headers: acting.headers, body })
      ).rejects.toMatchObject({
        statusCode: 409,
        body: { code: "AUTHORIZATION_VERSION_CONFLICT" },
      })
      const stale = new Headers(acting.headers)
      stale.set("X-Expected-Authz-Version", String(version - 1))
      await expect(
        runtime.auth.api[method]({ headers: stale, body })
      ).rejects.toMatchObject({
        statusCode: 409,
        body: { code: "AUTHORIZATION_VERSION_CONFLICT" },
      })
      expect(await authorizationVersion(org.id)).toBe(version)
      expect(await memberAudit(org.id, member.id)).toEqual([])
      await runtime.auth.api[method]({
        headers: await versionHeaders(acting, org.id),
        body,
      })
      expect(await authorizationVersion(org.id)).toBe(version + 1)
      expect(await memberAudit(org.id, member.id)).toEqual([
        {
          event_code: eventCode,
          actor_id: acting.user.id,
          request_id: expect.any(String),
          fields:
            method === "updateMemberRole"
              ? {
                  userId: recipient.user.id,
                  previousRole: "member",
                  role: "admin",
                }
              : { userId: recipient.user.id, role: "member" },
        },
      ])
      const rows = (
        await migrator.query("SELECT role FROM member WHERE id = $1", [
          member.id,
        ])
      ).rows
      expect(rows).toEqual(
        method === "updateMemberRole" ? [{ role: "admin" }] : []
      )
    }
  )

  it("admin and delegated member actions cannot manage owner or admin identities", async () => {
    const owner = await signup(),
      admin = await signup(),
      target = await signup(),
      delegate = await signup()
    const org = await organization(owner)
    const ownerMembership = (
      await migrator.query(
        "SELECT id FROM member WHERE organization_id = $1 AND user_id = $2",
        [org.id, owner.user.id]
      )
    ).rows[0]
    const adminMembership = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: admin.user.id, role: "admin" },
    })
    const targetMembership = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: target.user.id, role: "member" },
    })
    expect(
      (
        await post(
          "organization/create-role",
          {
            organizationId: org.id,
            role: "member-manager",
            permission: { member: ["read", "update", "delete"] },
          },
          owner.cookie
        )
      ).status
    ).toBe(200)
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: delegate.user.id,
        role: "member-manager",
      },
    })
    const version = await authorizationVersion(org.id)
    for (const acting of [admin, delegate]) {
      for (const [memberId, role] of [
        [targetMembership.id, "admin"],
        [targetMembership.id, "owner"],
        [adminMembership.id, "member"],
        [ownerMembership.id, "member"],
      ]) {
        const response = await post(
          "organization/update-member-role",
          { organizationId: org.id, memberId, role },
          acting.cookie
        )
        expect(response.status).toBe(403)
      }
      for (const memberIdOrEmail of [
        adminMembership.id,
        adminMembership.id.toUpperCase(),
        admin.email.toUpperCase(),
        ownerMembership.id,
      ]) {
        const response = await post(
          "organization/remove-member",
          { organizationId: org.id, memberIdOrEmail },
          acting.cookie
        )
        expect(response.status).toBe(403)
      }
      await expect(
        runtime.auth.api.updateMemberRole({
          headers: await versionHeaders(acting, org.id),
          body: {
            organizationId: org.id,
            memberId: targetMembership.id,
            role: "admin",
          },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        body: { code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN" },
      })
      await expect(
        runtime.auth.api.removeMember({
          headers: await versionHeaders(acting, org.id),
          body: { organizationId: org.id, memberIdOrEmail: adminMembership.id },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        body: { code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN" },
      })
    }
    expect(await authorizationVersion(org.id)).toBe(version)
    expect(await memberAudit(org.id, adminMembership.id)).toEqual([])
    expect(await memberAudit(org.id, targetMembership.id)).toEqual([])
    expect(
      (
        await migrator.query("SELECT role FROM member WHERE id = $1", [
          adminMembership.id,
        ])
      ).rows
    ).toEqual([{ role: "admin" }])
  })

  it("internal addMember cannot bypass owner promotion or admin assignment rules", async () => {
    const owner = await signup(),
      admin = await signup(),
      recipient = await signup()
    const org = await organization(owner)
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: admin.user.id, role: "admin" },
    })
    const version = await authorizationVersion(org.id)
    for (const [actor, role] of [
      [owner, "owner"],
      [admin, "admin"],
    ]) {
      await expect(
        runtime.auth.api.addMember({
          headers: actor.headers,
          body: { organizationId: org.id, userId: recipient.user.id, role },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        body: { code: "MEMBER_ROLE_MANAGEMENT_FORBIDDEN" },
      })
    }
    expect(
      (
        await migrator.query(
          "SELECT id FROM member WHERE organization_id = $1 AND user_id = $2",
          [org.id, recipient.user.id]
        )
      ).rowCount
    ).toBe(0)
    expect(await authorizationVersion(org.id)).toBe(version)
  })

  it("owner promotion requires a verified existing member and rejects multiple roles", async () => {
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
    await migrator.query(
      'UPDATE public."user" SET email_verified = false WHERE id = $1',
      [recipient.user.id]
    )
    const version = await authorizationVersion(org.id)
    const body = { organizationId: org.id, memberId: member.id, role: "owner" }
    const response = await post(
      "organization/update-member-role",
      body,
      owner.cookie
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: "MEMBER_EMAIL_UNVERIFIED",
    })
    await expect(
      runtime.auth.api.updateMemberRole({
        headers: await versionHeaders(owner, org.id),
        body,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      body: { code: "MEMBER_EMAIL_UNVERIFIED" },
    })
    for (const role of [["member", "admin"], ["member"], "member,admin"]) {
      const multiple = await post(
        "organization/update-member-role",
        { ...body, role },
        owner.cookie
      )
      expect(multiple.status).toBe(400)
      expect(await multiple.json()).toMatchObject({
        code: "SINGLE_ROLE_REQUIRED",
      })
    }
    expect(await authorizationVersion(org.id)).toBe(version)
    expect(await memberAudit(org.id, member.id)).toEqual([])
    expect(
      (
        await migrator.query("SELECT role FROM member WHERE id = $1", [
          member.id,
        ])
      ).rows
    ).toEqual([{ role: "member" }])
    await migrator.query(
      'UPDATE public."user" SET email_verified = true WHERE id = $1',
      [recipient.user.id]
    )
    expect(
      (await post("organization/update-member-role", body, owner.cookie)).status
    ).toBe(200)
    expect(
      (
        await migrator.query(
          "SELECT role FROM member WHERE organization_id = $1",
          [org.id]
        )
      ).rows
    ).toEqual([{ role: "owner" }, { role: "owner" }])
  })

  it.each(["update-member-role", "remove-member", "leave"])(
    "the last owner cannot perform %s",
    async (action) => {
      const owner = await signup()
      const org = await organization(owner)
      const member = (
        await migrator.query(
          "SELECT id FROM member WHERE organization_id = $1",
          [org.id]
        )
      ).rows[0]
      const version = await authorizationVersion(org.id)
      const body =
        action === "update-member-role"
          ? { organizationId: org.id, memberId: member.id, role: "member" }
          : action === "remove-member"
            ? { organizationId: org.id, memberIdOrEmail: member.id }
            : { organizationId: org.id }
      const response = await post(`organization/${action}`, body, owner.cookie)
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({
        code: "LAST_OWNER_REQUIRED",
      })
      expect(
        (
          await migrator.query("SELECT role FROM member WHERE id = $1", [
            member.id,
          ])
        ).rows
      ).toEqual([{ role: "owner" }])
      expect(await authorizationVersion(org.id)).toBe(version)
      expect(await memberAudit(org.id, member.id)).toEqual([])
    }
  )

  it("removal preserves the user, other membership and projects while revoking the old cookie's organization access", async () => {
    const owner = await signup(),
      recipient = await signup()
    const org = await organization(owner)
    const other = await organization(recipient)
    const member = await runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: recipient.user.id,
        role: "admin",
      },
    })
    const created = await fetch(
      `${baseURL}/api/v1/organizations/${org.id}/projects`,
      {
        method: "POST",
        headers: {
          origin,
          cookie: recipient.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Retained project",
          description: null,
          contentLocale: "en-US",
        }),
      }
    )
    expect(created.status).toBe(201)
    const project = await created.json()
    const otherMembership = (
      await migrator.query("SELECT id FROM member WHERE organization_id = $1", [
        other.id,
      ])
    ).rows[0]
    const foreignUser = await signup()
    const foreignMember = await runtime.auth.api.addMember({
      headers: recipient.headers,
      body: {
        organizationId: other.id,
        userId: foreignUser.user.id,
        role: "member",
      },
    })
    const foreignRole = await post(
      "organization/update-member-role",
      { organizationId: org.id, memberId: foreignMember.id, role: "member" },
      owner.cookie
    )
    expect(foreignRole.status).toBe(403)
    const foreignRemoval = await post(
      "organization/remove-member",
      { organizationId: org.id, memberIdOrEmail: foreignMember.id },
      owner.cookie
    )
    expect(foreignRemoval.status).toBe(403)
    const missingRemoval = await post(
      "organization/remove-member",
      { organizationId: org.id, memberIdOrEmail: randomUUID() },
      owner.cookie
    )
    expect(missingRemoval.status).toBe(403)
    expect((await missingRemoval.json()).code).toBe(
      (await foreignRemoval.json()).code
    )
    expect(
      (
        await post(
          "organization/remove-member",
          { organizationId: org.id, memberIdOrEmail: member.id },
          owner.cookie
        )
      ).status
    ).toBe(200)
    expect(
      (
        await fetch(
          `${baseURL}/api/auth/organization/list-members?organizationId=${org.id}`,
          { headers: recipient.headers }
        )
      ).status
    ).toBe(403)
    expect(
      (
        await fetch(`${baseURL}/api/v1/organizations/${org.id}/projects`, {
          headers: recipient.headers,
        })
      ).status
    ).toBe(403)
    expect(
      (
        await fetch(
          `${baseURL}/api/auth/organization/list-members?organizationId=${other.id}`,
          { headers: recipient.headers }
        )
      ).status
    ).toBe(200)
    expect(
      (
        await fetch(`${baseURL}/api/v1/organizations/${other.id}/projects`, {
          headers: recipient.headers,
        })
      ).status
    ).toBe(200)
    expect(
      (
        await fetch(
          `${baseURL}/api/v1/organizations/${org.id}/projects/${project.id}`,
          { headers: owner.headers }
        )
      ).status
    ).toBe(200)
    expect(
      (
        await migrator.query('SELECT id FROM public."user" WHERE id = $1', [
          recipient.user.id,
        ])
      ).rowCount
    ).toBe(1)
    expect(
      (
        await migrator.query(
          "SELECT id FROM member WHERE organization_id = $1 AND user_id = $2",
          [other.id, recipient.user.id]
        )
      ).rows
    ).toEqual([{ id: otherMembership.id }])
    expect(await memberAudit(org.id, member.id)).toEqual([
      expect.objectContaining({
        event_code: "member.removed",
        actor_id: owner.user.id,
        fields: { userId: recipient.user.id, role: "admin" },
      }),
    ])
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

  it("audit failure rolls back each member action, authorization version and active organization", async () => {
    const actor = await signup(),
      recipient = await signup()
    const org = await organization(actor)
    const member = await runtime.auth.api.addMember({
      headers: actor.headers,
      body: {
        organizationId: org.id,
        userId: recipient.user.id,
        role: "member",
      },
    })
    await runtime.auth.api.setActiveOrganization({
      headers: recipient.headers,
      body: { organizationId: org.id },
    })
    const version = await authorizationVersion(org.id)
    await migrator.query(`CREATE FUNCTION s8_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'S8 injected audit failure'; END $$;
      CREATE TRIGGER s8_fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION s8_fail_audit()`)
    try {
      for (const [action, body, cookie] of [
        [
          "update-member-role",
          { organizationId: org.id, memberId: member.id, role: "admin" },
          actor.cookie,
        ],
        [
          "remove-member",
          { organizationId: org.id, memberIdOrEmail: member.id },
          actor.cookie,
        ],
        ["leave", { organizationId: org.id }, recipient.cookie],
      ]) {
        const response = await post(`organization/${action}`, body, cookie)
        expect(response.status).toBe(500)
        expect(
          (
            await migrator.query("SELECT role FROM member WHERE id = $1", [
              member.id,
            ])
          ).rows
        ).toEqual([{ role: "member" }])
        expect(await authorizationVersion(org.id)).toBe(version)
        expect(await memberAudit(org.id, member.id)).toEqual([])
        expect(
          (await runtime.auth.api.getSession({ headers: recipient.headers }))
            .session.activeOrganizationId
        ).toBe(org.id)
      }
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
    const remainingMember = await runtime.auth.api.addMember({
      headers: inviter.headers,
      body: {
        organizationId: org.id,
        userId: remainingOwner.user.id,
        role: "member",
      },
    })
    await runtime.auth.api.updateMemberRole({
      headers: await versionHeaders(inviter, org.id),
      body: {
        organizationId: org.id,
        memberId: remainingMember.id,
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
