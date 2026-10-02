import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  PlatformStoragePolicySchema,
  PlatformStoragePolicyUpdateResultSchema,
} from "../../packages/contracts/src/index.ts"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform storage policy HTTP authorization and atomic changes", () => {
  let environment, admin, auditor, owner, organization
  const origin = "http://localhost:3201"
  const url = (id = organization.id) =>
    `${environment.baseURL}/api/v1/platform/organizations/${id}/storage-policy`
  const request = (actor = admin, body, key = randomUUID(), headers = {}, id) =>
    fetch(url(id), {
      method: body ? "PATCH" : "GET",
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
        ...(body ? { "Idempotency-Key": key } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  const current = async () => {
    const response = await request()
    expect(response.status).toBe(200)
    return PlatformStoragePolicySchema.parse(await response.json())
  }
  const input = async (quotaBytes) => ({
    quotaBytes,
    trashDays: 7,
    historyDays: 15,
    reason: "Approved capacity and retention change",
    expectedVersion: (await current()).version,
  })
  const facts = async (operation) =>
    (
      await environment.migrator.query(
        "SELECT fact FROM public.storage_http_facts WHERE fact->>'operation_id'=$1",
        [operation]
      )
    ).rows.map((row) => row.fact)
  async function scoped(work) {
    const client = await environment.runtime.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('app.organization_id',$1,true)", [
        organization.id,
      ])
      const result = await work(client)
      await client.query("COMMIT")
      return result
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }
  const contentFacts = () =>
    scoped(async (client) => ({
      entries: (
        await client.query(
          "SELECT to_jsonb(e) AS fact FROM public.file_entries e ORDER BY id"
        )
      ).rows,
      versions: (
        await client.query(
          "SELECT to_jsonb(v) AS fact FROM public.file_versions v ORDER BY id"
        )
      ).rows,
    }))
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    await environment.migrator
      .query(`CREATE TABLE public.storage_http_facts(fact jsonb NOT NULL);
      CREATE FUNCTION public.storage_http_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN INSERT INTO public.storage_http_facts VALUES(to_jsonb(NEW)); RETURN NEW; END; $$;
      CREATE TRIGGER storage_http_capture AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.storage_http_capture();`)
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: {
        name: "Private storage content",
        slug: `storage-${randomUUID()}`,
      },
    })
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("returns only the scoped safe summary to platform roles and denies tenant or anonymous callers", async () => {
    const summary = await current()
    expect(summary).toEqual({
      organizationId: organization.id,
      quotaBytes: 10 * 2 ** 30,
      usedBytes: 0,
      reservedBytes: 0,
      transientBytes: 0,
      trashDays: 30,
      historyDays: 90,
      version: 1,
      overQuota: false,
    })
    const response = await request(auditor)
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.json()).toEqual(summary)
    expect((await request(owner)).status).toBe(403)
    expect((await fetch(url())).status).toBe(401)
    expect(
      (await request(admin, undefined, undefined, {}, randomUUID())).status
    ).toBe(404)
    expect(
      (await request(admin, undefined, undefined, {}, "invalid")).status
    ).toBe(400)
    const text = JSON.stringify(summary)
    for (const value of [
      environment.config.databaseURL,
      environment.config.secret,
      organization.name,
    ])
      expect(text).not.toContain(value)
    expect(
      (
        await environment.runtime.pool.query(
          "SELECT has_table_privilege(current_user, 'file_storage_usage', 'UPDATE') AS allowed"
        )
      ).rows[0].allowed
    ).toBe(false)
    expect(
      (
        await environment.migrator.query(
          "SELECT has_table_privilege('platform_executor','file_entries','SELECT') AS allowed"
        )
      ).rows[0].allowed
    ).toBe(false)
  })

  it("lowers capacity without deleting content or rewriting existing retention facts, and commits one private audit", async () => {
    const root = randomUUID(),
      file = randomUUID(),
      currentVersion = randomUUID(),
      history = randomUUID()
    await scoped(async (client) => {
      await client.query(
        "INSERT INTO public.file_entries (id,organization_id,kind,name,path,created_by) VALUES ($1,$2,'folder','',ARRAY[]::text[],$3)",
        [root, organization.id, owner.user.id]
      )
      await client.query(
        `INSERT INTO public.file_entries (id,organization_id,kind,parent_id,name,path,state,current_version_id,trash_root_id,deleted_at,expires_at,created_by)
        VALUES ($1,$2,'file',$3,'private-body.txt',ARRAY['private-body.txt'],'trashed',$4,$1,now(),now()+interval '30 days',$5)`,
        [file, organization.id, root, currentVersion, owner.user.id]
      )
      await client.query(
        `INSERT INTO public.file_versions (id,organization_id,file_id,bytes,sha256,content_type,storage_area,storage_path,created_by,retired_at,expires_at)
        VALUES ($1::uuid,$2::uuid,$3::uuid,10,repeat('a',64),'text/plain','trash',ARRAY[$3::text,$1::text],$4,null,null),
        ($5::uuid,$2::uuid,$3::uuid,10,repeat('b',64),'text/plain','history',ARRAY[$3::text,$5::text],$4,now(),now()+interval '90 days')`,
        [currentVersion, organization.id, file, owner.user.id, history]
      )
      await client.query(
        "UPDATE public.file_storage_usage SET used_bytes=20,reserved_bytes=2,transient_bytes=3"
      )
    })
    const before = await contentFacts(),
      body = await input(5),
      key = randomUUID()
    const response = await request(admin, body, key)
    expect(response.status).toBe(200)
    const result = PlatformStoragePolicyUpdateResultSchema.parse(
      await response.json()
    )
    expect(result).toMatchObject({
      quotaBytes: 5,
      usedBytes: 20,
      reservedBytes: 2,
      transientBytes: 3,
      trashDays: 7,
      historyDays: 15,
      version: body.expectedVersion + 1,
      changed: true,
      overQuota: true,
    })
    expect(await contentFacts()).toEqual(before)
    const replay = await request(admin, body, key)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toEqual(result)
    expect(await facts(result.operationId)).toEqual([
      expect.objectContaining({
        organization_id: organization.id,
        actor_id: admin.user.id,
        scope: "platform",
        event_code: "platform.storage_policy_updated",
        tenant_visible: false,
        reason: body.reason,
        fields: {
          previous: {
            quotaBytes: 10 * 2 ** 30,
            trashDays: 30,
            historyDays: 90,
          },
          quotaBytes: 5,
          trashDays: 7,
          historyDays: 15,
          version: result.version,
        },
      }),
    ])
    const reused = await request(
      admin,
      { ...body, reason: "A distinct business purpose" },
      key
    )
    expect(reused.status).toBe(409)
    expect(await reused.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    })
    const stale = await request(admin, body)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: "VERSION_CONFLICT" })
    const unchanged = await request(admin, await input(5))
    expect(await unchanged.json()).toMatchObject({
      changed: false,
      result: "no_change",
      version: result.version,
    })
  })

  it("validates exact byte/day/reason/key constraints and enforces MFA, role and trusted origin", async () => {
    const body = await input(50)
    for (const invalid of [
      { ...body, quotaBytes: -1 },
      { ...body, quotaBytes: 0.5 },
      { ...body, quotaBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...body, trashDays: 0 },
      { ...body, historyDays: 2147483648 },
      { ...body, expectedVersion: 0 },
      { ...body, reason: " " },
      { ...body, reason: "x".repeat(501) },
      { ...body, usedBytes: 0 },
      { ...body, storageBackend: "s3" },
    ])
      expect((await request(admin, invalid)).status).toBe(400)
    expect((await request(admin, body, "invalid key")).status).toBe(400)
    expect((await request(admin, body, "")).status).toBe(400)
    expect((await request(auditor, body)).status).toBe(403)
    expect((await request(owner, body)).status).toBe(403)
    expect(
      (
        await request(admin, body, undefined, {
          origin: "http://untrusted.example",
        })
      ).status
    ).toBe(403)
    expect(
      (
        await fetch(url(), {
          method: "PATCH",
          headers: {
            cookie: admin.cookie,
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(403)
    await environment.migrator.query(
      "UPDATE platform_session_assurance SET verified_at=clock_timestamp()-interval '16 minutes' WHERE user_id=$1",
      [admin.user.id]
    )
    try {
      const response = await request(admin, body)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        code: "PLATFORM_MFA_REQUIRED",
      })
      expect((await request()).status).toBe(200)
    } finally {
      await environment.migrator.query(
        "UPDATE platform_session_assurance SET verified_at=clock_timestamp() WHERE user_id=$1",
        [admin.user.id]
      )
    }
    expect((await current()).version).toBe(body.expectedVersion)
  })

  it("allows exactly one simultaneous update of the same version", async () => {
    const body = await input(50)
    const responses = await Promise.all([
      request(admin, body),
      request(admin, { ...body, quotaBytes: 100 }),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ])
    expect((await current()).version).toBe(body.expectedVersion + 1)
  })

  it("rolls back policy and receipt on audit failure, preserves content and safely retries", async () => {
    const before = await current(),
      content = await contentFacts(),
      body = await input(500),
      key = randomUUID()
    await environment.migrator
      .query(`CREATE FUNCTION public.storage_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='platform.storage_policy_updated' THEN RAISE EXCEPTION 'private audit fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER storage_http_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.storage_http_fail();`)
    try {
      const response = await request(admin, body, key)
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: "AUDIT_UNAVAILABLE" })
      expect(await current()).toEqual(before)
      expect(await contentFacts()).toEqual(content)
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER storage_http_fail ON public.audit_events; DROP FUNCTION public.storage_http_fail()"
      )
    }
    const retry = await request(admin, body, key)
    expect(retry.status).toBe(200)
    const result = await retry.json()
    expect(result.version).toBe(before.version + 1)
    expect(await facts(result.operationId)).toHaveLength(1)
    await environment.migrator
      .query(`CREATE FUNCTION public.storage_http_read_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_code='platform.storage_policy_viewed' THEN RAISE EXCEPTION 'summary audit fault'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER storage_http_read_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.storage_http_read_fail();`)
    try {
      const denied = await request()
      expect(denied.status).toBe(503)
      expect(await denied.json()).toMatchObject({ code: "AUDIT_UNAVAILABLE" })
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER storage_http_read_fail ON public.audit_events; DROP FUNCTION public.storage_http_read_fail()"
      )
    }
  })

  async function waitForBlockedCall(functionName) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      const result = await environment.runtime.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE query LIKE $1 AND wait_event_type='Lock'",
        [`SELECT public.${functionName}(%`]
      )
      if (result.rowCount) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`HTTP ${functionName} did not reach its database row lock`)
  }
  it("rechecks current organization-platform authority after waiting for the policy row", async () => {
    const actor = await platformOperator(environment, origin)
    const locked = await environment.runtime.pool.connect()
    let pending
    try {
      await locked.query("BEGIN")
      await locked.query("SELECT set_config('app.organization_id',$1,true)", [
        organization.id,
      ])
      await locked.query(
        "UPDATE public.file_storage_usage SET used_bytes=used_bytes WHERE organization_id=$1",
        [organization.id]
      )
      pending = request(actor)
      await waitForBlockedCall("get_platform_storage_policy")
      await environment.deployerPool.query(
        "UPDATE platform_assignment SET status='revoked',revoked_at=now(),revoked_by=current_user,revoke_reason='Scope revoked during wait' WHERE user_id=$1",
        [actor.user.id]
      )
      await locked.query("COMMIT")
      const response = await pending
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" })
    } finally {
      await locked.query("ROLLBACK")
      locked.release()
      await pending?.catch(() => {})
    }
  })

  it("rechecks an expired session before replaying a receipt after waiting", async () => {
    const actor = await platformOperator(environment, origin),
      body = await input(600),
      key = randomUUID()
    const original = await request(actor, body, key)
    expect(original.status).toBe(200)
    const locked = await environment.runtime.pool.connect()
    let pending
    try {
      await locked.query("BEGIN")
      await locked.query("SELECT set_config('app.organization_id',$1,true)", [
        organization.id,
      ])
      await locked.query(
        "UPDATE public.file_storage_usage SET used_bytes=used_bytes WHERE organization_id=$1",
        [organization.id]
      )
      pending = request(actor, body, key)
      await waitForBlockedCall("update_platform_storage_policy")
      await environment.migrator.query(
        "UPDATE public.\"session\" SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
        [actor.user.id]
      )
      await locked.query("COMMIT")
      const response = await pending
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" })
    } finally {
      await locked.query("ROLLBACK")
      locked.release()
      await pending?.catch(() => {})
    }
    expect((await request(actor)).status).toBe(401)
  })
})
