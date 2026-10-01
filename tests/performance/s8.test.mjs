import { randomUUID } from "node:crypto"
import { arch, cpus, platform, totalmem } from "node:os"
import { performance } from "node:perf_hooks"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  AuditEventsPageSchema,
  PlatformAuditPageSchema,
  PlatformOrganizationPageSchema,
  PlatformUsersPageSchema,
} from "../../packages/contracts/src/index.ts"
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { auditEvents } from "../../packages/database/src/schema/audit.ts"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const DAY = 86_400_000
const CONCURRENCY = 20
const SAMPLES = 200

describe("S8 published HTTP performance with production authorization and auditing", () => {
  let environment, admin, owner, owners, organizations, window, initialCounts
  const origin = "http://localhost:3201"

  // bootstrap 仅用于核对测试库全局事实；造数和计量不更改运行角色、RLS、触发器或固定函数。
  async function inspect(sql) {
    const result = await environment.databaseContainer.exec([
      "psql",
      "-q",
      "-U",
      "bootstrap_admin",
      "-d",
      "enterprise_admin",
      "-Atc",
      sql,
    ])
    expect(result.exitCode, result.stderr).toBe(0)
    return JSON.parse(result.stdout.trim())
  }

  const counts = () =>
    inspect(`SELECT json_build_object(
    'organizations',(SELECT count(*) FROM organization),
    'users',(SELECT count(*) FROM public."user"),
    'auditEvents',(SELECT count(*) FROM audit_events))`)

  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    admin = await platformOperator(environment, origin)
    owners = []
    organizations = []
    for (let index = 0; index < 100; index++) {
      const actor = await signUpVerified(
        environment.baseURL,
        origin,
        environment.migrator
      )
      owners.push(actor)
      organizations.push(
        await environment.runtime.auth.api.createOrganization({
          headers: actor.headers,
          body: {
            name: `Performance organization ${index}`,
            slug: `performance-${index}`,
          },
        })
      )
    }
    owner = owners[0]
    // 100 个独立 owner 与 9899 名普通成员遵守每组织 100 人上限，另有 1 名独立平台管理员。
    const users = Array.from({ length: 9899 }, (_, index) => ({
      id: randomUUID(),
      name: `Performance member ${index}`,
      email: `performance-${index}@example.test`,
    }))
    await environment.migrator.query(
      `INSERT INTO public."user"(id,name,email,email_verified)
       SELECT id::uuid,name,email,true FROM jsonb_to_recordset($1::jsonb)
       AS seed(id text,name text,email text)`,
      [JSON.stringify(users)]
    )
    // 每组织串行执行原生成员管理，组织之间并行；保持真实授权版本、owner 与审计约束。
    let nextOrganization = 0
    const seeded = await Promise.allSettled(
      Array.from({ length: 10 }, async () => {
        while (nextOrganization < organizations.length) {
          const index = nextOrganization++
          for (
            let offset = index;
            offset < users.length;
            offset += organizations.length
          ) {
            await environment.runtime.auth.api.addMember({
              headers: owners[index].headers,
              body: {
                organizationId: organizations[index].id,
                userId: users[offset].id,
                role: "member",
              },
            })
          }
        }
      })
    )
    for (const result of seeded)
      if (result.status === "rejected") throw result.reason
    const current = await counts()
    expect(current.organizations).toBe(100)
    expect(current.users).toBe(10000)
    expect(current.auditEvents).toBeLessThan(100000)
    const runInTenant = createTenantRunner(environment.runtime.pool)
    const remaining = 100000 - current.auditEvents
    const seedTime = Date.now()
    for (const [index, organization] of organizations.entries()) {
      const count =
        Math.floor(remaining / 100) + (index < remaining % 100 ? 1 : 0)
      const membershipId = organization.members.find(
        (member) => member.userId === owners[index].user.id
      ).id
      await runInTenant(
        {
          organizationId: organization.id,
          userId: owners[index].user.id,
          membershipId,
          requestId: randomUUID(),
          locale: "en-US",
        },
        async (tx) => {
          await tx.insert(auditEvents).values(
            Array.from({ length: count }, (_, event) => ({
              organizationId: organization.id,
              scope: "tenant",
              eventCode: "member.role_changed",
              actorId: owners[index].user.id,
              resourceType: "member",
              resourceId: membershipId,
              requestId: randomUUID(),
              tenantVisible: true,
              fields: {},
              occurredAt: new Date(seedTime - ((event % 89) + 1) * DAY),
            }))
          )
        },
        "write"
      )
    }
    await environment.migrator.query("ANALYZE")
    initialCounts = await counts()
    expect(initialCounts).toEqual({
      organizations: 100,
      users: 10000,
      auditEvents: 100000,
    })
    const end = Date.now()
    window = {
      from: new Date(end - 90 * DAY).toISOString(),
      to: new Date(end).toISOString(),
    }
    // 保留原投影查询的执行计划作为瓶颈证据；诊断发生在计量前，不替代真实 HTTP 样本。
    const plan = await inspect(`SET ROLE platform_executor;
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT * FROM public.platform_audit_projection
      WHERE occurred_at BETWEEN '${window.from}'::timestamptz AND '${window.to}'::timestamptz
      ORDER BY occurred_at DESC,id DESC LIMIT 21`)
    const nodes = []
    const visit = (node) => {
      nodes.push({
        type: node["Node Type"],
        relation: node["Relation Name"],
        rows: node["Actual Rows"],
        timeMs: node["Actual Total Time"],
      })
      for (const child of node.Plans ?? []) visit(child)
    }
    visit(plan[0].Plan)
    console.log(
      "S8_PERFORMANCE_PROJECTION_PLAN " +
        JSON.stringify({ executionMs: plan[0]["Execution Time"], nodes })
    )
    const postgres = await inspect(`SELECT json_build_object(
      'version',version(),'sharedBuffers',current_setting('shared_buffers'),
      'maxConnections',current_setting('max_connections'))`)
    const limits = await environment.databaseContainer.exec([
      "sh",
      "-c",
      "cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max",
    ])
    expect(limits.exitCode, limits.stderr).toBe(0)
    console.log(
      "S8_PERFORMANCE_ENV " +
        JSON.stringify({
          node: process.version,
          platform: platform(),
          arch: arch(),
          cpu: cpus()[0].model,
          cpuCount: cpus().length,
          memoryBytes: totalmem(),
          postgres,
          databaseCgroupLimits: limits.stdout.trim().split("\n"),
          runtimePoolMax: environment.runtime.pool.options.max,
          concurrency: CONCURRENCY,
          samplesPerEndpoint: SAMPLES,
          initialCounts,
          smtpMeasured: false,
        })
    )
  })

  afterAll(async () => {
    await environment?.close()
  })

  async function measure({ name, path, cookie, schema, threshold, verify }) {
    const request = async (worker) => {
      const start = performance.now()
      const response = await fetch(environment.baseURL + path, {
        // 20 个客户端各自保持固定 IP，仍使用生产限流；每客户端对每个端点只发 11 次请求。
        headers: { cookie, "x-real-ip": `10.24.0.${worker + 1}` },
      })
      const body = await response.json()
      const elapsed = performance.now() - start
      expect(response.status, JSON.stringify(body)).toBe(200)
      const result = schema ? schema.parse(body) : body
      verify(result)
      return elapsed
    }
    await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, worker) => request(worker))
    )
    const durations = []
    const started = performance.now()
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async (_, worker) => {
        for (let sample = worker; sample < SAMPLES; sample += CONCURRENCY) {
          durations.push(await request(worker))
        }
      })
    )
    durations.sort((a, b) => a - b)
    const p95 = durations[Math.ceil(SAMPLES * 0.95) - 1]
    console.log(
      "S8_PERFORMANCE_RESULT " +
        JSON.stringify({
          name,
          samples: durations.length,
          concurrency: CONCURRENCY,
          p50Ms: durations[Math.ceil(SAMPLES * 0.5) - 1],
          p95Ms: p95,
          maxMs: durations.at(-1),
          durationMs: performance.now() - started,
          thresholdMs: threshold,
        })
    )
    expect(durations).toHaveLength(SAMPLES)
    expect(p95, name).toBeLessThan(threshold)
  }

  it("normal directory lists have P95 below 500 ms at concurrency 20", async () => {
    for (const endpoint of [
      {
        name: "platform organizations",
        path: "/api/v1/platform/organizations?page=1&pageSize=20",
        cookie: admin.cookie,
        schema: PlatformOrganizationPageSchema,
        verify: (page) => {
          expect(page.total).toBe(100)
          expect(page.items).toHaveLength(20)
        },
      },
      {
        name: "platform users",
        path: "/api/v1/platform/users?page=1&pageSize=20",
        cookie: admin.cookie,
        schema: PlatformUsersPageSchema,
        verify: (page) => {
          expect(page.total).toBe(10000)
          expect(page.items).toHaveLength(20)
        },
      },
      {
        name: "organization members",
        path: `/api/auth/organization/list-members?organizationId=${organizations[0].id}&limit=20&offset=0`,
        cookie: owner.cookie,
        verify: (page) => {
          expect(page.total).toBe(100)
          expect(page.members).toHaveLength(20)
        },
      },
    ])
      await measure({ ...endpoint, threshold: 500 })
  })

  it("90 day audit lists have P95 below 1000 ms at concurrency 20", async () => {
    const tenantQuery = new URLSearchParams({ ...window, limit: "20" })
    const platformQuery = new URLSearchParams({
      ...window,
      limit: "20",
      purpose: "S8 performance acceptance",
    })
    for (const endpoint of [
      {
        name: "tenant audit 90 days",
        path: `/api/v1/organizations/${organizations[0].id}/audit-events?${tenantQuery}`,
        cookie: owner.cookie,
        schema: AuditEventsPageSchema,
      },
      {
        name: "platform audit 90 days",
        path: `/api/v1/platform/audit-events?${platformQuery}`,
        cookie: admin.cookie,
        schema: PlatformAuditPageSchema,
      },
    ])
      await measure({
        ...endpoint,
        threshold: 1000,
        verify: (page) => expect(page.items).toHaveLength(20),
      })
    const end = await counts()
    // 平台受限读取继续追加真实审计，计量结束的审计数不能人为冻结在初始十万。
    expect(end.auditEvents).toBeGreaterThan(initialCounts.auditEvents)
    console.log("S8_PERFORMANCE_FINAL_COUNTS " + JSON.stringify(end))
  })
})
