import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startFilesEnvironment } from "../setup/files-environment.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const requireJobs = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)
const requireApi = createRequire(
  new URL("../../apps/api/package.json", import.meta.url)
)
const ExcelJS = requireJobs("exceljs")
const { PlatformTasks } = requireApi("./dist/platform/tasks/platform-tasks.js")
const mediaType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const resourcesToExport = [
  "users",
  "organizations",
  "sessions",
  "login-events",
  "audit-events",
]

describe("platform exports through HTTP, BullMQ and private storage", () => {
  const resources = new AsyncDisposableStack()
  const origin = "http://localhost:3200"
  const marker = `export-${randomUUID()}`
  let environment, admin, auditor, exporter, target, other
  let organizations, window, loginId, auditId

  const request = (path, actor = admin, options = {}) =>
    fetch(`${environment.baseURL}/api/v1/platform${path}`, {
      ...options,
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
        ...options.headers,
      },
    })

  const submit = (resource, filters, actor = admin) =>
    request("/exports", actor, {
      method: "POST",
      headers: { "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ resource, filters }),
    })

  async function exported(resource, filters, actor = admin) {
    const submitted = await submit(resource, filters, actor)
    expect(submitted.status, await submitted.clone().text()).toBe(202)
    expect(submitted.headers.get("cache-control")).toBe("private, no-store")
    const task = await submitted.json()
    expect(task).toMatchObject({
      kind: "export",
      resource,
      actorId: actor.user.id,
    })
    let completed
    await expect
      .poll(
        async () => {
          const response = await request(`/tasks/${task.id}`, actor)
          expect(response.status, await response.clone().text()).toBe(200)
          completed = await response.json()
          return { status: completed.status, errorCode: completed.errorCode }
        },
        { timeout: 30000 }
      )
      .toEqual({ status: "completed", errorCode: null })
    expect(completed.resultAvailable).toBe(true)
    const response = await request(`/tasks/${task.id}/result`, actor)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(response.headers.get("content-type")).toContain(mediaType)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-disposition")).toContain(
      `platform-task-${task.id}.xlsx`
    )
    const bytes = await response.arrayBuffer()
    expect(Number(response.headers.get("content-length"))).toBe(
      bytes.byteLength
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(bytes)
    expect(workbook.worksheets).toHaveLength(1)
    const sheet = workbook.getWorksheet("Export")
    expect(sheet).toBeDefined()
    const columns = sheet.getRow(1).values.slice(1)
    const rows = []
    sheet.eachRow((row, number) => {
      if (number > 1)
        rows.push(
          Object.fromEntries(
            columns.map((column, index) => [
              column,
              row.getCell(index + 1).value,
            ])
          )
        )
    })
    expect(completed.result).toMatchObject({ total: rows.length, failed: 0 })
    return { columns, rows }
  }

  beforeAll(async () => {
    environment = await startFilesEnvironment("RustFS", resources)
    // 复用正式队列启动入口；请求提交、持久扫描、BullMQ 执行及私有产物均走生产链路。
    environment.app.get(PlatformTasks).start()
    admin = await platformOperator(environment, origin)
    auditor = await platformOperator(environment, origin, "platform_auditor")
    const role = `export-only-${randomUUID()}`
    await environment.observer.query(
      "INSERT INTO platform_role(key,name,status,permissions) VALUES($1,$1,'active',$2)",
      [
        role,
        [
          "platform.user:export",
          "platform.task:read",
          "platform.task:download",
        ],
      ]
    )
    exporter = await platformOperator(environment, origin, role)
    target = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      {
        name: `${marker} target`,
        email: `private-${randomUUID()}@example.test`,
      }
    )
    other = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: `${marker} other` }
    )
    organizations = []
    for (const suffix of ["Alpha", "Beta", "Gamma", "Outside"])
      organizations.push(
        await environment.runtime.auth.api.createOrganization({
          headers: target.headers,
          body: {
            name:
              suffix === "Outside"
                ? "Outside export search"
                : `${marker} ${suffix}`,
            slug: `exports-${randomUUID()}`,
          },
        })
      )
    const suspended = await request(
      `/organizations/${organizations[1].id}/suspend`,
      admin,
      {
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: JSON.stringify({
          expectedVersion: 1,
          reason: "Export status filter fixture",
        }),
      }
    )
    expect(suspended.status, await suspended.clone().text()).toBe(200)

    // 历史窗口避开本次登录及导出自身审计；逐项改变过滤维度，防止错误参数映射仍碰巧命中。
    const at = Date.now() - 86400000
    window = {
      from: new Date(at - 1000).toISOString(),
      to: new Date(at + 1000).toISOString(),
    }
    const login = {
      userId: target.user.id,
      name: target.user.name,
      method: "email",
      result: "failed",
      at,
    }
    for (const [index, change] of [
      {},
      { userId: other.user.id },
      { name: "Different login name" },
      { method: "totp" },
      { result: "succeeded" },
      { at: at - 2000 },
      { at: at + 2000 },
    ].entries()) {
      const row = { ...login, ...change }
      const id = randomUUID()
      if (index === 0) loginId = id
      await environment.observer.query(
        `INSERT INTO login_events(id,user_id,name,masked_email,occurred_at,method,result,reason_code,request_id)
         VALUES($1,$2,$3,'p***@example.test',$4,$5,$6,$7,$8)`,
        [
          id,
          row.userId,
          row.name,
          new Date(row.at),
          row.method,
          row.result,
          row.result === "failed" ? "INVALID_CREDENTIALS" : null,
          randomUUID(),
        ]
      )
    }
    const audit = {
      organizationId: organizations[0].id,
      actorId: target.user.id,
      eventCode: "member.role_changed",
      result: "succeeded",
      at,
    }
    for (const [index, change] of [
      {},
      { organizationId: organizations[2].id },
      { actorId: other.user.id },
      { eventCode: "member.removed" },
      { result: "failed" },
      { at: at - 2000 },
      { at: at + 2000 },
    ].entries()) {
      const row = { ...audit, ...change }
      const id = randomUUID()
      if (index === 0) auditId = `event:${id}`
      await environment.observer.query(
        `INSERT INTO audit_events(id,organization_id,scope,event_code,actor_id,resource_type,resource_id,result,request_id,tenant_visible,occurred_at,reason,fields)
         VALUES($1,$2,'tenant',$3,$4,'member',$5,$6,$7,true,$8,'private-export-reason',$9)`,
        [
          id,
          row.organizationId,
          row.eventCode,
          row.actorId,
          randomUUID(),
          row.result,
          randomUUID(),
          new Date(row.at),
          { email: target.email, token: "private-export-token" },
        ]
      )
    }
  })
  afterAll(() => resources.disposeAsync())

  it("exports the users search with the approved masked projection", async () => {
    const { columns, rows } = await exported("users", { q: target.user.name })
    expect(columns).toEqual([
      "userId",
      "name",
      "maskedEmail",
      "emailVerified",
      "createdAt",
      "organizationCount",
      "status",
      "version",
    ])
    expect(rows).toEqual([
      expect.objectContaining({
        userId: target.user.id,
        name: target.user.name,
        maskedEmail: "p***@example.test",
        emailVerified: true,
        organizationCount: 4,
        status: "active",
      }),
    ])
    expect(JSON.stringify(rows)).not.toContain(target.email)
  })

  it("exports organizations using search, status and requested ordering", async () => {
    const { rows } = await exported("organizations", {
      q: marker,
      status: "ACTIVE",
      sortBy: "name",
      sortOrder: "desc",
    })
    expect(rows.map((row) => row.id)).toEqual([
      organizations[2].id,
      organizations[0].id,
    ])
    expect(rows.map((row) => [row.status, row.memberCount])).toEqual([
      ["ACTIVE", 1],
      ["ACTIVE", 1],
    ])
  })

  it("exports only the requested user's live sessions without session secrets", async () => {
    const expected = await environment.observer.query(
      "SELECT id,token FROM session WHERE user_id=$1 AND expires_at>clock_timestamp() ORDER BY created_at DESC,id DESC",
      [target.user.id]
    )
    expect(expected.rows.length).toBeGreaterThan(0)
    const { columns, rows } = await exported("sessions", {
      q: target.user.name,
      userId: target.user.id,
    })
    expect(rows.map((row) => row.sessionId)).toEqual(
      expected.rows.map((row) => row.id)
    )
    expect(
      rows.every(
        (row) =>
          row.userId === target.user.id &&
          row.maskedEmail === "p***@example.test"
      )
    ).toBe(true)
    expect(columns).not.toContain("token")
    for (const secret of [
      target.email,
      ...expected.rows.map((row) => row.token),
    ])
      expect(JSON.stringify(rows)).not.toContain(secret)
  })

  it("exports login events with all identity, method, result and time filters", async () => {
    const { rows } = await exported("login-events", {
      q: target.user.name,
      userId: target.user.id,
      result: "failed",
      method: "email",
      ...window,
    })
    expect(rows).toEqual([
      expect.objectContaining({
        id: loginId,
        userId: target.user.id,
        method: "email",
        result: "failed",
      }),
    ])
    expect(JSON.stringify(rows)).not.toContain(target.email)
  })

  it("exports the filtered audit window with flattened approved fields", async () => {
    const { columns, rows } = await exported("audit-events", {
      organizationId: organizations[0].id,
      actorId: target.user.id,
      eventCode: "member.role_changed",
      result: "succeeded",
      ...window,
    })
    expect(columns).toContain("targetOrganization.organizationId")
    expect(rows).toEqual([
      expect.objectContaining({
        id: auditId,
        "targetOrganization.organizationId": organizations[0].id,
        "targetOrganization.name": organizations[0].name,
        actorId: target.user.id,
        actorMaskedEmail: "p***@example.test",
        eventCode: "member.role_changed",
        result: "succeeded",
      }),
    ])
    for (const secret of [
      target.email,
      "private-export-reason",
      "private-export-token",
    ])
      expect(JSON.stringify(rows)).not.toContain(secret)
  })

  it("does not infer export permission from read access for any resource", async () => {
    for (const resource of resourcesToExport) {
      const listed = await request(`/${resource}`, auditor)
      expect(listed.status, resource).toBe(200)
      const response = await submit(resource, {}, auditor)
      expect(response.status, resource).toBe(403)
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" })
    }
    const tasks = await request("/tasks", auditor)
    expect(tasks.status).toBe(200)
    expect((await tasks.json()).items).toEqual([])
  })

  it("allows user export without the ordinary user-list read permission", async () => {
    expect((await request("/users", exporter)).status).toBe(403)
    const { rows } = await exported("users", { q: target.user.name }, exporter)
    expect(rows.map((row) => row.userId)).toEqual([target.user.id])
  })
})
