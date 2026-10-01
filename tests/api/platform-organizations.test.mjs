import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform organization operations", () => {
  let environment, admin, auditor, owner, organization
  const origin = "http://localhost:3201"
  const request = (path, actor = admin, options = {}) =>
    fetch(`${environment.baseURL}/api/v1/platform/organizations${path}`, {
      ...options,
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
        ...options.headers,
      },
    })
  const transition = (
    action,
    body,
    key = randomUUID(),
    actor = admin,
    id = organization.id
  ) =>
    request(`/${id}/${action}`, actor, {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify(body),
    })
  async function auditFacts(id, statement, values) {
    const connection = await environment.migrator.connect()
    try {
      await connection.query("BEGIN")
      await connection.query(
        "SELECT set_config('app.organization_id', $1, true)",
        [id]
      )
      return await connection.query(statement, values)
    } finally {
      await connection.query("ROLLBACK")
      connection.release()
    }
  }
  const createOrganization = () =>
    environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "State boundary", slug: `boundary-${randomUUID()}` },
    })
  async function waitForLock(lockType) {
    const end = Date.now() + 5000
    while (Date.now() < end) {
      const result = await environment.migrator.query(
        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = $1 AND NOT granted) AS waiting",
        [lockType]
      )
      if (result.rows[0].waiting) return
      await delay(10)
    }
    throw new Error(`Expected blocked ${lockType} lock`)
  }
  const createProject = (id) =>
    fetch(`${environment.baseURL}/api/v1/organizations/${id}/projects`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Commit boundary project",
        description: null,
        contentLocale: "en-US",
      }),
    })
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Issue 20 Alpha", slug: `issue-20-${randomUUID()}` },
    })
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("queries only organization operating metadata through a paginated, validated platform API", async () => {
    const response = await request(
      "?q=Issue%2020&pageSize=1&sortBy=name&sortOrder=asc"
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(await response.json()).toEqual({
      items: [
        expect.objectContaining({
          id: organization.id,
          name: "Issue 20 Alpha",
          slug: organization.slug,
          status: "ACTIVE",
          version: 1,
          memberCount: 1,
          createdAt: expect.any(String),
        }),
      ],
      page: 1,
      pageSize: 1,
      total: 1,
    })
    expect((await request("?sortBy=email")).status).toBe(400)
    expect((await request("", owner)).status).toBe(403)
  })

  it("projects member counts and status history without exposing identity snapshots or tenant business", async () => {
    const response = await request(`/${organization.id}`, auditor)
    expect(response.status).toBe(200)
    const detail = await response.json()
    expect(detail).toMatchObject({
      id: organization.id,
      defaultLocale: null,
      members: [{ role: "owner", count: 1 }],
      history: [],
    })
    expect(JSON.stringify(detail)).not.toContain(owner.email)
    expect(detail).not.toHaveProperty("projects")
    const missingId = randomUUID()
    const missing = await request(`/${missingId}`, auditor)
    expect(missing.status).toBe(404)
    const failures = await auditFacts(
      missingId,
      "SELECT event_code, result, reason FROM public.audit_events WHERE organization_id = $1",
      [missingId]
    )
    expect(failures.rows).toEqual([
      {
        event_code: "platform.organization_viewed",
        result: "failed",
        reason: "NOT_FOUND",
      },
    ])
  })

  it("suspends atomically, replays the original receipt, audits no_change and resumes without duplicating transitions", async () => {
    const key = randomUUID()
    const body = { reason: "Issue 20 confirmed suspension", expectedVersion: 1 }
    const changed = await transition("suspend", body, key)
    expect(changed.status).toBe(200)
    const result = await changed.json()
    expect(result).toMatchObject({
      status: "SUSPENDED",
      version: 2,
      changed: true,
      result: "succeeded",
      operationId: expect.any(String),
    })
    expect(await (await transition("suspend", body, key)).json()).toEqual(
      result
    )
    const reuse = await transition(
      "suspend",
      { ...body, reason: "A different suspension reason" },
      key
    )
    expect(reuse.status).toBe(409)
    expect(await reuse.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" })
    const denied = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
      { headers: { cookie: owner.cookie } }
    )
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({
      code: "ORGANIZATION_SUSPENDED",
    })
    const noChange = await transition("suspend", {
      reason: "Already suspended, verify state",
      expectedVersion: 2,
    })
    expect(await noChange.json()).toMatchObject({
      status: "SUSPENDED",
      version: 2,
      changed: false,
      result: "no_change",
    })
    const stale = await transition("resume", {
      reason: "Restore after issue 20 review",
      expectedVersion: 1,
    })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT" })
    const resumed = await transition("resume", {
      reason: "Restore after issue 20 review",
      expectedVersion: 2,
    })
    expect(await resumed.json()).toMatchObject({
      status: "ACTIVE",
      version: 3,
      changed: true,
    })
    expect(
      (
        await fetch(
          `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
          { headers: { cookie: owner.cookie } }
        )
      ).status
    ).toBe(200)
    const detail = await (await request(`/${organization.id}`, auditor)).json()
    expect(detail.history.map((item) => item.eventCode)).toEqual([
      "platform.organization_resumed",
      "platform.organization_suspended",
    ])
    const facts = await auditFacts(
      organization.id,
      `SELECT event_code, result FROM public.audit_events
      WHERE organization_id = $1 AND event_code = 'platform.organization_transition_attempted'`,
      [organization.id]
    )
    expect(facts.rows).toContainEqual({
      event_code: "platform.organization_transition_attempted",
      result: "no_change",
    })
  })

  it("rejects auditors, invalid inputs and untrusted cookie write origins without changing state", async () => {
    const body = {
      reason: "Valid organization operation reason",
      expectedVersion: 3,
    }
    expect(
      (await transition("suspend", body, randomUUID(), auditor)).status
    ).toBe(403)
    expect(
      (await transition("resume", body, randomUUID(), auditor)).status
    ).toBe(403)
    for (const reason of ["short", "x".repeat(501), " ".repeat(20)]) {
      expect((await transition("suspend", { ...body, reason })).status).toBe(
        400
      )
    }
    expect(
      (
        await request(`/${organization.id}/suspend`, admin, {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(400)
    expect(
      (
        await request(`/${organization.id}/suspend`, admin, {
          method: "POST",
          headers: {
            origin: "https://untrusted.example",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(403)
    expect(
      (
        await request(`/${organization.id}/suspend`, admin, {
          method: "POST",
          headers: {
            origin: "",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(403)
    expect((await (await request(`/${organization.id}`)).json()).status).toBe(
      "ACTIVE"
    )
    expect(
      (
        await fetch(
          `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
          { headers: { cookie: admin.cookie } }
        )
      ).status
    ).toBe(403)
    await expect(
      environment.runtime.pool.query(
        "UPDATE public.organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
        [organization.id]
      )
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      environment.runtime.pool.query("SELECT * FROM public.operation_receipts")
    ).rejects.toMatchObject({ code: "42501" })
  })

  it("rechecks role and recent MFA before replaying a receipt and expires the receipt after 24 hours", async () => {
    const target = await createOrganization()
    const key = randomUUID(),
      body = { reason: "Recent MFA and receipt boundary", expectedVersion: 1 }
    const original = await (
      await transition("suspend", body, key, admin, target.id)
    ).json()
    const receipt = await environment.migrator.query(
      "SELECT expires_at FROM public.operation_receipts WHERE operation_id = $1",
      [original.operationId]
    )
    expect(receipt.rows[0].expires_at.getTime() - Date.now()).toBeGreaterThan(
      23.9 * 60 * 60 * 1000
    )
    await environment.migrator.query(
      "UPDATE public.platform_session_assurance SET verified_at = clock_timestamp() - interval '16 minutes' WHERE user_id = $1",
      [admin.user.id]
    )
    try {
      const replay = await transition("suspend", body, key, admin, target.id)
      expect(replay.status).toBe(403)
      expect(await replay.json()).toMatchObject({
        code: "PLATFORM_MFA_REQUIRED",
      })
      expect((await request(`/${target.id}`)).status).toBe(200)
    } finally {
      await environment.migrator.query(
        "UPDATE public.platform_session_assurance SET verified_at = clock_timestamp() WHERE user_id = $1",
        [admin.user.id]
      )
    }
    await environment.deployerPool.query(
      "UPDATE public.platform_assignment SET role = 'platform_auditor' WHERE user_id = $1",
      [admin.user.id]
    )
    try {
      expect(
        (await transition("suspend", body, key, admin, target.id)).status
      ).toBe(403)
    } finally {
      await environment.deployerPool.query(
        "UPDATE public.platform_assignment SET role = 'platform_admin' WHERE user_id = $1",
        [admin.user.id]
      )
    }
    await environment.migrator.query(
      "UPDATE public.operation_receipts SET expires_at = clock_timestamp() - interval '1 second' WHERE operation_id = $1",
      [original.operationId]
    )
    const expired = await transition("suspend", body, key, admin, target.id)
    expect(expired.status).toBe(409)
    expect(await expired.json()).toMatchObject({ code: "VERSION_CONFLICT" })
  })

  it("serializes concurrent commands and same-key retries into one committed transition", async () => {
    const target = await createOrganization()
    const key = randomUUID(),
      body = {
        reason: "Concurrent organization state request",
        expectedVersion: 1,
      }
    const repeated = await Promise.all([
      transition("suspend", body, key, admin, target.id),
      transition("suspend", body, key, admin, target.id),
    ])
    expect(repeated.map((response) => response.status)).toEqual([200, 200])
    const results = await Promise.all(
      repeated.map((response) => response.json())
    )
    expect(results[0]).toEqual(results[1])
    const races = await Promise.all([
      transition(
        "resume",
        { ...body, expectedVersion: 2 },
        randomUUID(),
        admin,
        target.id
      ),
      transition(
        "resume",
        { ...body, expectedVersion: 2 },
        randomUUID(),
        admin,
        target.id
      ),
    ])
    expect(races.map((response) => response.status).sort()).toEqual([200, 409])
    const detail = await (await request(`/${target.id}`)).json()
    expect(detail.version).toBe(3)
    expect(detail.history).toHaveLength(2)
    expect(JSON.stringify(detail)).not.toContain(body.reason)
  })

  it("rolls back state, authorization version and receipts when success auditing fails, and fails closed on reads", async () => {
    const target = await createOrganization()
    const key = randomUUID(),
      body = { reason: "Audit failure rollback acceptance", expectedVersion: 1 }
    await environment.migrator
      .query(`CREATE FUNCTION public.issue20_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_code IN ('platform.organization_suspended', 'platform.organization_viewed') THEN
        RAISE EXCEPTION 'issue 20 audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER issue20_audit_failure BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue20_audit_failure();`)
    try {
      const failed = await transition("suspend", body, key, admin, target.id)
      expect(failed.status).toBe(503)
      expect(await failed.json()).toMatchObject({ code: "AUDIT_UNAVAILABLE" })
      const facts = await environment.migrator.query(
        "SELECT status, status_version, authorization_version FROM public.organization_status WHERE organization_id = $1",
        [target.id]
      )
      expect(facts.rows[0]).toEqual({
        status: "ACTIVE",
        status_version: 1,
        authorization_version: 2,
      })
      expect(
        (
          await environment.migrator.query(
            "SELECT 1 FROM public.operation_receipts WHERE scope_key = $1",
            [`platform:organization:${target.id}`]
          )
        ).rowCount
      ).toBe(0)
      const read = await request(`/${target.id}`)
      expect(read.status).toBe(503)
      expect(await read.json()).not.toHaveProperty("members")
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER issue20_audit_failure ON public.audit_events; DROP FUNCTION public.issue20_audit_failure()"
      )
    }
    expect(
      (await transition("suspend", body, key, admin, target.id)).status
    ).toBe(200)
  })

  for (const writeFirst of [true, false]) {
    it(
      writeFirst
        ? "commits an already locked tenant write before suspension"
        : "rejects a tenant write waiting behind the suspension commit",
      async () => {
        const target = await createOrganization()
        const blocker = await environment.migrator.connect()
        await blocker.query("SELECT pg_advisory_lock(100020)")
        await environment.migrator
          .query(`CREATE FUNCTION public.issue20_commit_gate() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(100020); RETURN NEW; END; $$;
        CREATE TRIGGER issue20_commit_gate AFTER INSERT ON public.${writeFirst ? "projects" : "audit_events"}
        FOR EACH ROW ${writeFirst ? "" : "WHEN (NEW.event_code = 'platform.organization_suspended')"} EXECUTE FUNCTION public.issue20_commit_gate();`)
        let writing, suspending
        try {
          if (writeFirst) writing = createProject(target.id)
          else
            suspending = transition(
              "suspend",
              {
                reason: "Commit boundary suspension request",
                expectedVersion: 1,
              },
              randomUUID(),
              admin,
              target.id
            )
          await waitForLock("advisory")
          if (writeFirst)
            suspending = transition(
              "suspend",
              {
                reason: "Commit boundary suspension request",
                expectedVersion: 1,
              },
              randomUUID(),
              admin,
              target.id
            )
          else writing = createProject(target.id)
          await waitForLock("transactionid")
          await blocker.query("SELECT pg_advisory_unlock(100020)")
          const [write, suspended] = await Promise.all([writing, suspending])
          expect(suspended.status).toBe(200)
          expect(write.status).toBe(writeFirst ? 201 : 403)
          if (!writeFirst)
            expect(await write.json()).toMatchObject({
              code: "ORGANIZATION_SUSPENDED",
            })
          await transition(
            "resume",
            {
              reason: "Read committed tenant facts after restore",
              expectedVersion: 2,
            },
            randomUUID(),
            admin,
            target.id
          )
          const projects = await (
            await fetch(
              `${environment.baseURL}/api/v1/organizations/${target.id}/projects`,
              { headers: { cookie: owner.cookie } }
            )
          ).json()
          expect(projects.total).toBe(writeFirst ? 1 : 0)
        } finally {
          await blocker.query("SELECT pg_advisory_unlock(100020)")
          await Promise.allSettled([writing, suspending].filter(Boolean))
          await environment.migrator.query(
            `DROP TRIGGER issue20_commit_gate ON public.${writeFirst ? "projects" : "audit_events"}; DROP FUNCTION public.issue20_commit_gate()`
          )
          blocker.release()
        }
      }
    )
  }

  it("restores availability without extending invitations or restoring removed memberships and platform assignments", async () => {
    const target = await createOrganization()
    const former = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const pending = await environment.runtime.auth.api.createInvitation({
      headers: owner.headers,
      body: {
        organizationId: target.id,
        email: `${randomUUID()}@example.test`,
        role: "member",
      },
    })
    await environment.migrator.query(
      "UPDATE public.invitation SET expires_at = timestamp '2020-01-01' WHERE id = $1",
      [pending.id]
    )
    const accepted = await environment.runtime.auth.api.createInvitation({
      headers: owner.headers,
      body: { organizationId: target.id, email: former.email, role: "member" },
    })
    await environment.runtime.auth.api.acceptInvitation({
      headers: former.headers,
      body: { invitationId: accepted.id },
    })
    const version = await environment.migrator.query(
      "SELECT authorization_version FROM public.organization_status WHERE organization_id = $1",
      [target.id]
    )
    const headers = new Headers(owner.headers)
    headers.set(
      "X-Expected-Authz-Version",
      String(version.rows[0].authorization_version)
    )
    const membership = await environment.migrator.query(
      "SELECT id FROM public.member WHERE organization_id = $1 AND user_id = $2",
      [target.id, former.user.id]
    )
    await environment.runtime.auth.api.removeMember({
      headers,
      body: {
        organizationId: target.id,
        memberIdOrEmail: membership.rows[0].id,
      },
    })
    await environment.deployerPool.query(
      "UPDATE public.platform_assignment SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by = current_user, revoke_reason = 'independent revocation' WHERE user_id = $1",
      [auditor.user.id]
    )
    expect(
      (
        await transition(
          "suspend",
          {
            reason: "Independent authorization preservation",
            expectedVersion: 1,
          },
          randomUUID(),
          admin,
          target.id
        )
      ).status
    ).toBe(200)
    expect(
      (
        await transition(
          "resume",
          {
            reason: "Independent authorization preservation",
            expectedVersion: 2,
          },
          randomUUID(),
          admin,
          target.id
        )
      ).status
    ).toBe(200)
    const expiration = await environment.migrator.query(
      "SELECT expires_at::text AS expires_at FROM public.invitation WHERE id = $1",
      [pending.id]
    )
    expect(expiration.rows[0].expires_at).toBe("2020-01-01 00:00:00")
    const formerAccess = await fetch(
      `${environment.baseURL}/api/v1/organizations/${target.id}/access`,
      { headers: { cookie: former.cookie } }
    )
    expect(formerAccess.status).toBe(403)
    const platform = await fetch(`${environment.baseURL}/api/v1/me/platform`, {
      headers: { cookie: auditor.cookie },
    })
    expect(platform.status).toBe(403)
    const replay = await fetch(
      `${environment.baseURL}/api/auth/organization/accept-invitation`,
      {
        method: "POST",
        headers: {
          cookie: former.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ invitationId: accepted.id }),
      }
    )
    expect(replay.status).not.toBe(200)
    const member = await environment.migrator.query(
      "SELECT 1 FROM public.member WHERE organization_id = $1 AND user_id = $2",
      [target.id, former.user.id]
    )
    expect(member.rowCount).toBe(0)
  })
  it("applies stable sorting, paging, status and empty search results to the operating list", async () => {
    const target = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Issue 20 Zulu", slug: `issue-20-zulu-${randomUUID()}` },
    })
    const first = await (
      await request("?q=Issue%2020&sortBy=name&sortOrder=desc&pageSize=1")
    ).json()
    const second = await (
      await request(
        "?q=Issue%2020&sortBy=name&sortOrder=desc&pageSize=1&page=2"
      )
    ).json()
    expect(first).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      items: [{ id: target.id }],
    })
    expect(second).toMatchObject({
      total: 2,
      page: 2,
      items: [{ id: organization.id }],
    })
    expect(
      (
        await transition(
          "suspend",
          {
            reason: "Verify the suspended status list filter",
            expectedVersion: 1,
          },
          randomUUID(),
          admin,
          target.id
        )
      ).status
    ).toBe(200)
    const suspended = await (
      await request("?q=Issue%2020&status=SUSPENDED")
    ).json()
    expect(suspended).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ id: target.id, status: "SUSPENDED" }],
    })
    expect(
      await (await request("?q=definitely-no-such-organization")).json()
    ).toMatchObject({ total: 0, items: [] })
    for (const query of [
      "?page=0",
      "?page=2147483648",
      "?pageSize=101",
      "?status=DELETED",
      "?sortOrder=DROP",
      "?q=" + "a".repeat(201),
    ]) {
      expect((await request(query)).status).toBe(400)
    }
  })
  it("rechecks current assignment after waiting for the organization lock and before replaying a receipt", async () => {
    const target = await createOrganization()
    const key = randomUUID()
    const body = {
      reason: "Reauthorize a receipt after the organization lock",
      expectedVersion: 1,
    }
    const original = await transition("suspend", body, key, admin, target.id)
    expect(original.status).toBe(200)
    const connection = await environment.migrator.connect()
    let replay,
      locked = false
    try {
      await connection.query("BEGIN")
      locked = true
      await connection.query(
        "SELECT organization_id FROM public.organization_status WHERE organization_id = $1 FOR UPDATE",
        [target.id]
      )
      replay = transition("suspend", body, key, admin, target.id)
      await waitForLock("transactionid")
      await environment.deployerPool.query(
        "UPDATE public.platform_assignment SET status = 'revoked', revoked_at = clock_timestamp(), revoked_by = current_user, revoke_reason = 'revocation while awaiting state lock' WHERE user_id = $1",
        [admin.user.id]
      )
      await connection.query("COMMIT")
      locked = false
      const denied = await replay
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({ code: "FORBIDDEN" })
      const receipts = await environment.migrator.query(
        "SELECT count(*) AS total FROM public.operation_receipts WHERE actor_id = $1 AND scope_key = $2",
        [admin.user.id, `platform:organization:${target.id}`]
      )
      expect(receipts.rows[0].total).toBe("1")
      const events = await auditFacts(
        target.id,
        "SELECT result FROM public.audit_events WHERE organization_id = $1 AND event_code = 'platform.organization_transition_attempted'",
        [target.id]
      )
      expect(events.rows).toEqual([{ result: "denied" }])
    } finally {
      if (locked) await connection.query("ROLLBACK")
      await Promise.allSettled([replay].filter(Boolean))
      connection.release()
      await environment.deployerPool.query(
        "UPDATE public.platform_assignment SET status = 'active', revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE user_id = $1",
        [admin.user.id]
      )
    }
  })
})
