import { randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  configureApiClient,
  listPlatformAuditEvents,
  getPlatformAuditEvent,
  createProject,
} from "../../packages/api-client/src/index.ts"
import {
  PlatformAuditPageSchema,
  PlatformAuditEventSchema,
} from "../../packages/contracts/src/index.ts"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("platform audit: approved cross-organization projections", () => {
  let environment,
    admin,
    auditor,
    tenantA,
    tenantB,
    orgA,
    orgB,
    projectA,
    projectB,
    detailId
  const origin = "http://localhost:3201"
  const request = (params = {}, actor = admin, eventId) => {
    const query = new URLSearchParams(params)
    return fetch(
      `${environment.baseURL}/api/v1/platform/audit-events${eventId ? `/${eventId}` : ""}?${query}`,
      { headers: { cookie: actor.cookie } }
    )
  }
  const cli = (action, userId) =>
    promisify(execFile)(
      process.execPath,
      [
        "apps/api/dist/console.js",
        "platform",
        "assignment",
        action,
        "--user-id",
        userId,
        "--role",
        "platform_auditor",
        "--reason",
        "private-assignment@example.test",
      ],
      {
        env: {
          PATH: process.env.PATH,
          PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
        },
      }
    )
  async function seedEvent(
    organization,
    actor,
    eventCode,
    occurredAt,
    id = randomUUID()
  ) {
    const client = await environment.runtime.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT set_config('app.organization_id',$1,true)", [
        organization.id,
      ])
      await client.query(
        `INSERT INTO public.audit_events(id,organization_id,scope,event_code,actor_id,resource_type,resource_id,request_id,tenant_visible,occurred_at,reason,fields)
        VALUES ($1,$2,'tenant',$3,$4,'member',$5,$6,true,$7,'private-reason@example.test',$8)`,
        [
          id,
          organization.id,
          eventCode,
          actor.user.id,
          randomUUID(),
          randomUUID(),
          occurredAt,
          { email: actor.email, token: "never-project-this", role: "member" },
        ]
      )
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
    return `event:${id}`
  }
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    // 核对真实提交行，不改变生产审计 RLS、函数或运行角色权限。
    await environment.migrator
      .query(`CREATE TABLE public.issue22_audit_facts(fact jsonb NOT NULL);
      CREATE FUNCTION public.issue22_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN INSERT INTO public.issue22_audit_facts VALUES (to_jsonb(NEW)); RETURN NEW; END; $$;
      CREATE TRIGGER issue22_capture AFTER INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue22_capture();`)
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    tenantA = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Audit tenant A", email: "audit-private-a@example.test" }
    )
    tenantB = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Audit tenant B", email: "audit-private-b@example.test" }
    )
    orgA = await environment.runtime.auth.api.createOrganization({
      headers: tenantA.headers,
      body: { name: "Audit organization A", slug: `audit-${randomUUID()}` },
    })
    orgB = await environment.runtime.auth.api.createOrganization({
      headers: tenantB.headers,
      body: { name: "Audit organization B", slug: `audit-${randomUUID()}` },
    })
    for (const [actor, org, name] of [
      [tenantA, orgA, "Only A project"],
      [tenantB, orgB, "Only B project"],
    ]) {
      configureApiClient({
        baseUrl: environment.baseURL,
        getHeaders: () => ({ cookie: actor.cookie, origin }),
      })
      const created = await createProject(org.id, {
        name,
        description: null,
        contentLocale: "en-US",
      })
      if (org === orgA) projectA = created.data
      else projectB = created.data
    }
    configureApiClient({
      baseUrl: environment.baseURL,
      getHeaders: () => ({ cookie: admin.cookie }),
    })
    await cli("grant", tenantA.user.id)
    await cli("revoke", tenantA.user.id)
    detailId = await seedEvent(
      orgA,
      tenantA,
      "member.role_changed",
      new Date(Date.now() - 86400000).toISOString()
    )
    await seedEvent(
      orgB,
      tenantB,
      "member.role_changed",
      new Date(Date.now() - 86400000).toISOString()
    )
  })
  afterAll(async () => {
    await environment?.close()
  })

  it("queries with the generated SDK after real MFA and CLI assignment changes without leaking internal identity or metadata", async () => {
    const response = await listPlatformAuditEvents({ pageSize: 100 })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const page = PlatformAuditPageSchema.parse(response.data)
    expect(
      page.items.some(
        (e) =>
          e.eventCode === "platform.mfa_verified" && e.actorId === admin.user.id
      )
    ).toBe(true)
    for (const code of ["platform.role_granted", "platform.role_revoked"])
      expect(
        page.items.some(
          (e) =>
            e.eventCode === code &&
            e.resourceId === tenantA.user.id &&
            e.actorType === "deployment_operator" &&
            e.result === "succeeded"
        )
      ).toBe(true)
    expect(
      page.items.some(
        (e) =>
          e.scope === "tenant" &&
          e.targetOrganization?.organizationId === orgA.id
      )
    ).toBe(true)
    const serialized = JSON.stringify(page)
    for (const privateValue of [
      tenantA.email,
      tenantB.email,
      "private-assignment@example.test",
      "private-reason@example.test",
      "never-project-this",
    ])
      expect(serialized).not.toContain(privateValue)
    expect(page.items.some((e) => e.eventCode.startsWith("project."))).toBe(
      false
    )
    const auditorPage = await (await request({ pageSize: 100 }, auditor)).json()
    expect(PlatformAuditPageSchema.safeParse(auditorPage).success).toBe(true)
    expect(JSON.stringify(auditorPage)).not.toContain(tenantA.email)
    const detail = await getPlatformAuditEvent(detailId)
    expect(PlatformAuditEventSchema.parse(detail.data)).toMatchObject({
      id: detailId,
      scope: "tenant",
      targetOrganization: { organizationId: orgA.id, name: orgA.name },
      actorMaskedEmail: "a***@example.test",
      metadata: {},
    })
  })

  it("records exactly one private access fact with a null reason without accepting a purpose field", async () => {
    for (const eventId of [undefined, detailId]) {
      const response = await request({}, auditor, eventId)
      expect(response.status).toBe(200)
      const body = await response.json()
      const facts = await environment.migrator.query(
        "SELECT fact FROM public.issue22_audit_facts WHERE fact->>'request_id'=$1 AND fact->>'event_code'=$2",
        [
          response.headers.get("x-request-id"),
          eventId ? "platform.audit_viewed" : "platform.audit_queried",
        ]
      )
      expect(facts.rows).toHaveLength(1)
      expect(facts.rows[0].fact).toMatchObject({
        actor_id: auditor.user.id,
        scope: "platform",
        result: "succeeded",
        tenant_visible: false,
        reason: null,
      })
      expect(facts.rows[0].fact.fields).toMatchObject(
        eventId
          ? { eventId }
          : {
              page: 1,
              pageSize: 20,
              from: body.window.from,
              to: body.window.to,
            }
      )
      expect(
        (await request({ purpose: "removed field" }, auditor, eventId)).status
      ).toBe(400)
    }
  })

  it("applies organization, actor, event, result and bounded time filters and records exactly one access fact per query", async () => {
    const query = {
      organizationId: orgA.id,
      actorId: tenantA.user.id,
      eventCode: "member.role_changed",
      result: "succeeded",
      from: new Date(Date.now() - 2 * 86400000).toISOString(),
      to: new Date().toISOString(),
      pageSize: 20,
    }
    const before = await environment.migrator.query(
      "SELECT count(*)::integer AS n FROM public.issue22_audit_facts WHERE fact->>'event_code'='platform.audit_queried'"
    )
    const page = await (await request(query, auditor)).json()
    expect(page.items).toHaveLength(1)
    expect(page.items[0].id).toBe(detailId)
    const after = await environment.migrator.query(
      "SELECT fact FROM public.issue22_audit_facts WHERE fact->>'event_code'='platform.audit_queried'"
    )
    expect(after.rows).toHaveLength(before.rows[0].n + 1)
    expect(after.rows.at(-1).fact).toMatchObject({
      scope: "platform",
      actor_id: auditor.user.id,
      reason: null,
      result: "succeeded",
      tenant_visible: false,
      fields: {
        organizationId: orgA.id,
        actorId: tenantA.user.id,
        eventCode: "member.role_changed",
        result: "succeeded",
        pageSize: 20,
      },
    })
    expect(
      (await (await request({ ...query, result: "failed" })).json()).items
    ).toEqual([])
  })

  it("supports numbered pages and exact totals within the database-resolved window", async () => {
    const at = new Date(Date.now() - 3600000).toISOString()
    const expected = []
    for (let n = 0; n < 3; n++)
      expected.push(await seedEvent(orgA, tenantA, "member.removed", at))
    const params = {
      organizationId: orgA.id,
      eventCode: "member.removed",
      pageSize: 1,
    }
    const first = PlatformAuditPageSchema.parse(
      await (await request(params)).json()
    )
    expect(first).toMatchObject({ page: 1, pageSize: 1, total: 3 })
    await seedEvent(orgA, tenantA, "member.removed", new Date().toISOString())
    const seen = []
    for (let page = 1; page <= 3; page++) {
      const result = await (
        await request({ ...params, ...first.window, page })
      ).json()
      expect(result).toMatchObject({
        page,
        pageSize: 1,
        total: 3,
        window: first.window,
      })
      seen.push(...result.items.map((event) => event.id))
    }
    expect(seen).toEqual(expected.sort().reverse())
    const beyond = await (
      await request({ ...params, ...first.window, page: 2_147_483_647 })
    ).json()
    expect(beyond).toMatchObject({ items: [], total: 3, page: 2_147_483_647 })
    expect(
      (
        await (
          await request({ ...params, ...first.window, page: 2, pageSize: 2 })
        ).json()
      ).items
    ).toHaveLength(1)
  })

  it("keeps its own read audit outside the resolved window when paging all operations", async () => {
    const params = {
      actorId: admin.user.id,
      eventCode: "platform.audit_queried",
      pageSize: 1,
    }
    const first = await (await request(params)).json()
    const repeated = await (
      await request({ ...params, ...first.window })
    ).json()
    const second = await (
      await request({ ...params, ...first.window, page: 2 })
    ).json()
    expect(repeated.total).toBe(first.total)
    expect(repeated.items).toEqual(first.items)
    expect(second.total).toBe(first.total)
  })

  it("preserves microsecond boundaries and ordering without a Date round trip", async () => {
    const day = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
    const from = `${day}T00:00:00.000001Z`
    const to = `${day}T00:00:00.000002Z`
    const older = await seedEvent(orgA, tenantA, "role.created", from)
    const newer = await seedEvent(orgA, tenantA, "role.created", to)
    const params = {
      organizationId: orgA.id,
      eventCode: "role.created",
      from,
      to,
      pageSize: 1,
    }
    const first = await (await request(params)).json()
    const second = await (
      await request({ ...params, ...first.window, page: 2 })
    ).json()
    expect(first).toMatchObject({ total: 2, items: [{ id: newer }] })
    expect(second).toMatchObject({ total: 2, items: [{ id: older }] })
    expect(first.window.from).toContain(".000001")
    expect(first.window.to).toContain(".000002")
  })

  it("pages tied timestamps across both audit sources without losing events or changing detail projections", async () => {
    const at = new Date(Date.now() - 7 * 86400000).toISOString()
    const expectedIds = []
    for (let index = 0; index < 4; index++) {
      expectedIds.push(
        await seedEvent(orgA, tenantA, "member.role_changed", at)
      )
    }
    const assignments = [
      {
        action: "grant",
        previous: null,
        next: "platform_auditor",
        result: "changed",
      },
      {
        action: "revoke",
        previous: "platform_auditor",
        next: null,
        result: "changed",
      },
      {
        action: "grant",
        previous: "platform_auditor",
        next: "platform_auditor",
        result: "no_change",
      },
    ]
    for (const assignment of assignments) {
      const id = randomUUID()
      await environment.deployerPool.query(
        `INSERT INTO public.platform_assignment_audit
        (id,user_id,action,previous_role,next_role,result,reason,actor,created_at)
        VALUES($1,$2,$3,$4,$5,$6,'private-mixed-reason@example.test','private-mixed-operator',$7)`,
        [
          id,
          tenantA.user.id,
          assignment.action,
          assignment.previous,
          assignment.next,
          assignment.result,
          at,
        ]
      )
      expectedIds.push(`assignment:${id}`)
    }
    const query = { from: at, to: at, pageSize: 2 }
    const events = []
    for (
      let page = 1;
      page <= Math.ceil(expectedIds.length / query.pageSize);
      page++
    ) {
      const response = await request({ ...query, page })
      expect(response.status).toBe(200)
      const result = PlatformAuditPageSchema.parse(await response.json())
      expect(result).toMatchObject({
        page,
        pageSize: query.pageSize,
        total: expectedIds.length,
      })
      events.push(...result.items)
    }
    expect(events.map((event) => event.id)).toEqual(
      expectedIds.sort().reverse()
    )
    for (const event of events) {
      const response = await request({}, admin, event.id)
      expect(response.status).toBe(200)
      expect(PlatformAuditEventSchema.parse(await response.json())).toEqual(
        event
      )
    }
    expect(JSON.stringify(events)).not.toContain(
      "private-mixed-reason@example.test"
    )
    expect(JSON.stringify(events)).not.toContain("private-mixed-operator")
    for (const filter of [
      { organizationId: orgA.id },
      { actorId: tenantA.user.id },
    ]) {
      const page = await (
        await request({ ...query, ...filter, pageSize: 100 })
      ).json()
      expect(page.items).toHaveLength(4)
      expect(page.items.every((event) => event.id.startsWith("event:"))).toBe(
        true
      )
    }
    const noChange = await (
      await request({ ...query, result: "no_change", pageSize: 100 })
    ).json()
    expect(noChange.items).toHaveLength(1)
    expect(noChange.items[0]).toMatchObject({
      eventCode: "platform.role_granted",
      metadata: {
        previousRole: "platform_auditor",
        nextRole: "platform_auditor",
      },
    })
  })

  it("rejects query expansion and invalid windows, and never expands into project or unknown audit data", async () => {
    for (const params of [
      { purpose: "a".repeat(501) },
      { table: "projects" },
      { include: "reason" },
      { organizationId: "bad" },
      { pageSize: 101 },
      { pageSize: 0 },
      { page: 0 },
      { page: 1.5 },
      { page: 2_147_483_648 },
      { cursor: "removed" },
      { limit: 20 },
      { from: new Date(Date.now() - 91 * 86400000).toISOString() },
      { to: new Date(Date.now() + 86400000).toISOString() },
      {
        from: new Date().toISOString(),
        to: new Date(Date.now() - 86400000).toISOString(),
      },
    ])
      expect((await request(params)).status, JSON.stringify(params)).toBe(400)
    expect((await request({}, admin, `event:${randomUUID()}`)).status).toBe(404)
    const excluded = await seedEvent(
      orgA,
      tenantA,
      "project.created",
      new Date().toISOString()
    )
    expect((await request({ eventCode: "project.created" })).status).toBe(200)
    expect(
      (await (await request({ eventCode: "project.created" })).json()).items
    ).toEqual([])
    expect((await request({}, admin, excluded)).status).toBe(404)
    expect((await request({}, tenantA)).status).toBe(403)
  })

  it("returns no restricted result when list or detail access auditing fails", async () => {
    await environment.migrator
      .query(`CREATE FUNCTION public.issue22_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_code IN ('platform.audit_queried','platform.audit_viewed') THEN RAISE EXCEPTION 'audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER issue22_fail BEFORE INSERT ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.issue22_fail();`)
    try {
      for (const id of [undefined, detailId]) {
        const response = await request({}, auditor, id)
        expect(response.status).toBe(503)
        const error = await response.json()
        expect(error.code).toBe("AUDIT_UNAVAILABLE")
        expect(error).not.toHaveProperty("items")
        expect(error).not.toHaveProperty("actorMaskedEmail")
      }
    } finally {
      await environment.migrator.query(
        "DROP TRIGGER issue22_fail ON public.audit_events; DROP FUNCTION public.issue22_fail()"
      )
    }
  })

  it("uses the database clock for default windows while still rejecting explicit future bounds", async () => {
    const actual = Date.now()
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(actual + 60000)
    try {
      const response = await request({ pageSize: 1 })
      expect(response.status).toBe(200)
      const page = await response.json()
      expect(page.items).toHaveLength(1)
      expect(
        (await request({ pageSize: 1, page: 2, ...page.window })).status
      ).toBe(200)
      expect(
        (await request({ to: new Date(actual + 30000).toISOString() })).status
      ).toBe(400)
    } finally {
      vi.useRealTimers()
    }
  })

  it("preserves A/B tenant isolation after platform queries, refuses direct view/helper access and retains executor ownership", async () => {
    for (let n = 0; n < 8; n++) {
      await request({})
      const pages = await Promise.all(
        [
          [tenantA, orgA],
          [tenantB, orgB],
        ].map(async ([actor, org]) => {
          const response = await fetch(
            `${environment.baseURL}/api/v1/organizations/${org.id}/projects`,
            { headers: { cookie: actor.cookie } }
          )
          expect(response.status).toBe(200)
          return response.json()
        })
      )
      expect(pages[0].items.map((p) => p.id)).toEqual([projectA.id])
      expect(pages[1].items.map((p) => p.id)).toEqual([projectB.id])
    }
    expect(
      (
        await fetch(
          `${environment.baseURL}/api/v1/organizations/${orgA.id}/projects`,
          { headers: { cookie: admin.cookie } }
        )
      ).status
    ).toBe(403)
    await expect(
      environment.runtime.pool.query(
        "SELECT * FROM public.platform_audit_projection"
      )
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      environment.runtime.pool.query(
        "SELECT public.is_platform_audit_event('platform','platform.mfa_verified')"
      )
    ).rejects.toMatchObject({ code: "42501" })
    const functions = await environment.migrator
      .query(`SELECT p.proname,pg_get_userbyid(p.proowner) AS owner,
      has_function_privilege('platform_runtime',p.oid,'EXECUTE') AS legacy,has_function_privilege('app_runtime',p.oid,'EXECUTE') AS runtime
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('list_platform_audit_events','get_platform_audit_event')`)
    expect(functions.rows).toHaveLength(2)
    for (const row of functions.rows)
      expect(row).toMatchObject({
        owner: "platform_executor",
        legacy: false,
        runtime: true,
      })
    await expect(
      environment.runtime.pool.query(
        "SELECT public.platform_audit_event_codes('platform')"
      )
    ).rejects.toMatchObject({ code: "42501" })
    const privateFunctions = await environment.migrator
      .query(`SELECT p.proname, p.proconfig,
      pg_get_userbyid(p.proowner) AS owner,
      has_function_privilege('app_runtime',p.oid,'EXECUTE') AS runtime
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('platform_audit_event_codes','is_platform_audit_event')`)
    expect(privateFunctions.rows).toHaveLength(2)
    for (const row of privateFunctions.rows)
      expect(row).toMatchObject({
        owner: "platform_executor",
        runtime: false,
        proconfig: ["search_path=pg_catalog"],
      })
    await cli("revoke", auditor.user.id)
    expect((await request({}, auditor)).status).toBe(403)
  })

  it("T24: platform audit and suspension reuse the same connection as concurrent A/B tenant reads without retaining platform context", async () => {
    const target = await environment.runtime.auth.api.createOrganization({
      headers: tenantA.headers,
      body: { name: "T24 suspended organization", slug: randomUUID() },
    })
    // 占住其余连接，使平台操作和两个组织的真实 HTTP 查询必然复用同一条连接。
    const held = await Promise.all(
      Array.from({ length: environment.runtime.pool.options.max - 1 }, () =>
        environment.runtime.pool.connect()
      )
    )
    try {
      const connection = await environment.runtime.pool.query(
        "SELECT pg_backend_pid() AS pid"
      )
      const suspended = await fetch(
        `${environment.baseURL}/api/v1/platform/organizations/${target.id}/suspend`,
        {
          method: "POST",
          headers: {
            cookie: admin.cookie,
            origin,
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            reason: "T24 connection isolation verification",
            expectedVersion: 1,
          }),
        }
      )
      expect(suspended.status).toBe(200)
      expect(await suspended.json()).toMatchObject({
        status: "SUSPENDED",
        changed: true,
      })
      for (let n = 0; n < 8; n++) {
        const audit = await request({})
        expect(audit.status).toBe(200)
        await audit.json()
        const pages = await Promise.all(
          [
            [tenantA, orgA],
            [tenantB, orgB],
          ].map(async ([actor, org]) => {
            const response = await fetch(
              `${environment.baseURL}/api/v1/organizations/${org.id}/projects`,
              {
                headers: { cookie: actor.cookie },
              }
            )
            expect(response.status).toBe(200)
            return response.json()
          })
        )
        expect(pages[0].items.map((p) => p.id)).toEqual([projectA.id])
        expect(pages[1].items.map((p) => p.id)).toEqual([projectB.id])
        const context = await environment.runtime.pool.query(
          "SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.organization_id',true),'') AS organization_id"
        )
        expect(context.rows).toEqual([
          { pid: connection.rows[0].pid, organization_id: null },
        ])
      }
      const denied = await fetch(
        `${environment.baseURL}/api/v1/organizations/${target.id}/projects`,
        {
          headers: { cookie: tenantA.cookie },
        }
      )
      expect(denied.status).toBe(403)
      expect(await denied.json()).toMatchObject({
        code: "ORGANIZATION_SUSPENDED",
      })
    } finally {
      for (const client of held) client.release()
    }
  })
})
