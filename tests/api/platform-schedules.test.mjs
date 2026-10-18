import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
const require = createRequire(import.meta.url)
const {
  PlatformSchedules,
} = require("../../apps/api/dist/platform/schedules/service.js")
const {
  PlatformMonitorService,
} = require("../../apps/api/dist/platform/monitor/service.js")

const snapshot = {
  observedAt: "2026-10-19T00:00:00Z",
  probes: [
    { key: "api", status: "up" },
    { key: "postgres", status: "down" },
  ],
  queues: [],
  platformExecutor: "stopped",
  worker: { status: "unconfigured" },
  http: { status: "unconfigured", windowSeconds: 300 },
}
describe("platform schedules authorization and runtime", () => {
  const origin = "http://localhost:3201"
  let environment, admin, service, monitor
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    admin = await assigned("platform_admin")
    service = environment.app.get(PlatformSchedules)
    monitor = environment.app.get(PlatformMonitorService)
  })
  afterEach(async () => {
    await service?.onApplicationShutdown()
    vi.restoreAllMocks()
    await environment?.observer.query(
      "UPDATE platform_schedules SET status='disabled',next_run_at=NULL"
    )
  })
  afterAll(async () => environment?.close())
  async function assigned(role, permissions) {
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    if (permissions)
      await environment.observer.query(
        "INSERT INTO platform_role(key,name,status,permissions) VALUES($1,$1,'active',$2)",
        [role, permissions]
      )
    await environment.observer.query(
      "INSERT INTO platform_assignment(user_id,status,version,granted_at,granted_by,grant_reason) VALUES($1,'active',1,clock_timestamp(),'schedule-test','Schedule test fixture')",
      [actor.user.id]
    )
    await environment.observer.query(
      "INSERT INTO platform_assignment_role(user_id,role_id) SELECT $1,id FROM platform_role WHERE key=$2",
      [actor.user.id, role]
    )
    actor.sessionId = (
      await environment.observer.query(
        "SELECT id FROM session WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [actor.user.id]
      )
    ).rows[0].id
    return actor
  }
  async function request(path, actor = admin, options = {}) {
    return fetch(`${environment.baseURL}/api/v1/platform/schedules${path}`, {
      ...options,
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
        ...options.headers,
      },
    })
  }
  async function create(name = randomUUID(), actor = admin) {
    const response = await request("", actor, {
      method: "POST",
      body: JSON.stringify({
        name,
        type: "platform.health-check",
        cron: "* * * * *",
        timeZone: "Asia/Shanghai",
        status: "enabled",
      }),
    })
    expect(response.status, await response.clone().text()).toBe(201)
    return response.json()
  }
  async function rows(id) {
    const response = await request(`/${id}/runs`)
    expect(response.status).toBe(200)
    return (await response.json()).items
  }
  async function leaderPid() {
    return (
      await environment.observer.query(
        "SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=20261019 AND objid=1 AND granted"
      )
    ).rows[0]?.pid
  }
  async function start() {
    service.start()
    await expect.poll(leaderPid, { timeout: 5000 }).toBeTypeOf("number")
  }
  async function fixed(client, actor, operation, schedule, input = {}) {
    return (
      await client.query(
        "SELECT public.platform_schedule_command($1,$2,$3,$4,$5::jsonb,$6) AS result",
        [
          actor.user.id,
          actor.sessionId,
          operation,
          schedule,
          JSON.stringify(input),
          randomUUID(),
        ]
      )
    ).rows[0].result
  }
  async function claim(client, schedule) {
    return (
      await client.query(
        "SELECT public.platform_schedule_runtime('claim',$1,$2::jsonb,NULL,NULL,$3) AS result",
        [
          schedule.id,
          JSON.stringify({
            trigger: "automatic",
            expectedNextRunAt: schedule.nextRunAt,
            nextRunAt: new Date(Date.now() + 60000).toISOString(),
          }),
          randomUUID(),
        ]
      )
    ).rows[0].result
  }
  async function waitOnAuthorization(pid) {
    await expect
      .poll(
        async () =>
          (
            await environment.observer.query(
              "SELECT wait_event FROM pg_stat_activity WHERE pid=$1",
              [pid]
            )
          ).rows[0]?.wait_event,
        { timeout: 5000 }
      )
      .toBe("advisory")
  }
  it("keeps plan metadata readable without allowing monitor snapshot access and protects private tables", async () => {
    const plan = await create()
    const reader = await assigned(`schedule-reader-${randomUUID()}`, [
      "platform.schedule:read",
    ])
    expect((await request("", reader)).status).toBe(200)
    expect((await request(`/${plan.id}`, reader)).status).toBe(200)
    expect((await request(`/${plan.id}/runs`, reader)).status).toBe(403)
    expect(
      (await request(`/${plan.id}/runs`, reader, { method: "POST" })).status
    ).toBe(403)
    for (const table of ["platform_schedules", "platform_schedule_runs"]) {
      await expect(
        environment.runtime.pool.query(`SELECT * FROM ${table}`)
      ).rejects.toMatchObject({ code: "42501" })
      const fact = (
        await environment.observer.query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
          [table]
        )
      ).rows[0]
      expect(fact).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
    }
    await expect(
      environment.runtime.pool.query(
        "SELECT public.platform_schedule_owner_denial($1)",
        [admin.user.id]
      )
    ).rejects.toMatchObject({ code: "42501" })
    await expect(
      environment.observer.query(
        "INSERT INTO platform_schedule_runs(schedule_id,schedule_name,task_type,owner_id,trigger,status,finished_at) VALUES($1,'Invalid success','platform.health-check',$2,'manual','succeeded',clock_timestamp())",
        [plan.id, admin.user.id]
      )
    ).rejects.toMatchObject({ code: "23514" })
    const page = await (await request("?page=999&pageSize=20")).json()
    expect(page.items).toEqual([])
    expect(page.total).toBeGreaterThan(0)
  })
  it("rejects invalid Cron/timezones, applies versioning and preserves deleted-plan history", async () => {
    for (const input of [
      { cron: "* * * * * *", timeZone: "UTC" },
      { cron: "* * * * *", timeZone: "No/Such_Zone" },
    ]) {
      expect(
        (
          await request("", admin, {
            method: "POST",
            body: JSON.stringify({
              name: "Invalid",
              type: "platform.health-check",
              status: "enabled",
              ...input,
            }),
          })
        ).status
      ).toBe(400)
    }
    vi.spyOn(monitor, "collect").mockResolvedValue(snapshot)
    const plan = await create()
    const run = await request(`/${plan.id}/runs`, admin, { method: "POST" })
    expect(run.status).toBe(202)
    await expect
      .poll(async () => (await rows(plan.id))[0]?.status)
      .toBe("succeeded")
    expect((await rows(plan.id))[0].result.probes[1].status).toBe("down")
    const changed = {
      name: "Changed",
      type: plan.type,
      cron: plan.cron,
      timeZone: plan.timeZone,
      status: "disabled",
      expectedVersion: plan.version,
    }
    expect(
      (
        await request(`/${plan.id}`, admin, {
          method: "PATCH",
          body: JSON.stringify(changed),
        })
      ).status
    ).toBe(200)
    expect(
      (
        await request(`/${plan.id}`, admin, {
          method: "PATCH",
          body: JSON.stringify(changed),
        })
      ).status
    ).toBe(409)
    expect(
      (await request(`/${plan.id}`, admin, { method: "DELETE" })).status
    ).toBe(200)
    expect((await request(`/${plan.id}`)).status).toBe(404)
    expect((await rows(plan.id))[0].scheduleName).toBe(plan.name)
  })
  it("uses one non-overlap rule for manual and automatic triggers and skips missed firings", async () => {
    const gate = Promise.withResolvers()
    const collect = vi
      .spyOn(monitor, "collect")
      .mockImplementation(async () => {
        await gate.promise
        return snapshot
      })
    const plan = await create()
    await environment.observer.query(
      "UPDATE platform_schedules SET next_run_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",
      [plan.id]
    )
    await start()
    await expect
      .poll(
        async () =>
          (
            await environment.observer.query(
              "SELECT next_run_at>clock_timestamp() AS future FROM platform_schedules WHERE id=$1",
              [plan.id]
            )
          ).rows[0].future
      )
      .toBe(true)
    expect(await rows(plan.id)).toEqual([])
    expect(collect).not.toHaveBeenCalled()
    const first = await request(`/${plan.id}/runs`, admin, { method: "POST" })
    expect(first.status).toBe(202)
    try {
      expect(
        (await request(`/${plan.id}/runs`, admin, { method: "POST" })).status
      ).toBe(409)
      expect(
        (await request(`/${plan.id}`, admin, { method: "DELETE" })).status
      ).toBe(409)
      await environment.observer.query(
        "UPDATE platform_schedules SET next_run_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [plan.id]
      )
      await expect
        .poll(
          async () =>
            (
              await environment.observer.query(
                "SELECT next_run_at>clock_timestamp() AS future FROM platform_schedules WHERE id=$1",
                [plan.id]
              )
            ).rows[0].future,
          { timeout: 5000 }
        )
        .toBe(true)
      expect(await rows(plan.id)).toHaveLength(1)
      expect(collect).toHaveBeenCalledOnce()
    } finally {
      gate.resolve()
    }
    await expect
      .poll(async () => (await rows(plan.id))[0]?.status)
      .toBe("succeeded")
  })
  it("automatically executes one due firing and persists the next future occurrence", async () => {
    await start()
    const plan = await create()
    await environment.observer.query(
      "UPDATE platform_schedules SET next_run_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [plan.id]
    )
    await expect
      .poll(async () => (await rows(plan.id))[0]?.status, { timeout: 5000 })
      .toBe("succeeded")
    expect((await rows(plan.id))[0]).toMatchObject({
      trigger: "automatic",
      requestedBy: null,
      errorCode: null,
    })
    expect((await rows(plan.id))[0].result.probes).toEqual(
      expect.arrayContaining([
        { key: "api", status: "up" },
        expect.objectContaining({ key: "postgres", status: "up" }),
        expect.objectContaining({ key: "redis", status: "up" }),
      ])
    )
    const current = await (await request(`/${plan.id}`)).json()
    expect(Date.parse(current.nextRunAt)).toBeGreaterThan(Date.now())
  })

  it("orders automatic claim before plan row locks so concurrent update cannot deadlock", async () => {
    const plan = await create()
    const updater = await environment.observer.connect()
    const automatic = await environment.runtime.pool.connect()
    const pid = (await automatic.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid
    let pending
    try {
      await updater.query("BEGIN")
      await updater.query("SELECT public.lock_platform_authorization()")
      pending = claim(automatic, plan)
      await waitOnAuthorization(pid)
      const changed = await fixed(updater, admin, "update", plan.id, {
        name: "Concurrent update",
        type: plan.type,
        cron: plan.cron,
        timeZone: plan.timeZone,
        status: "enabled",
        expectedVersion: plan.version,
        nextRunAt: new Date(Date.now() + 120000).toISOString(),
      })
      expect(changed.version).toBe(plan.version + 1)
      await updater.query("COMMIT")
      expect(await pending).toBeNull()
    } finally {
      await updater.query("ROLLBACK")
      await pending?.catch(() => undefined)
      updater.release()
      automatic.release()
    }
  })
  it("reads creator authorization after the shared lock, records concurrent revocation as rejection and never executes", async () => {
    const role = `schedule-owner-${randomUUID()}`
    const creator = await assigned(role, [
      "platform.schedule:read",
      "platform.schedule:manage",
      "platform.schedule:run",
      "platform.monitor:read",
    ])
    const plan = await create("Owner-bound schedule", creator)
    const collect = vi.spyOn(monitor, "collect").mockResolvedValue(snapshot)
    const revoker = await environment.observer.connect()
    const automatic = await environment.runtime.pool.connect()
    const pid = (await automatic.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid
    let pending
    try {
      await revoker.query("BEGIN")
      await revoker.query("SELECT public.lock_platform_authorization()")
      pending = claim(automatic, plan)
      await waitOnAuthorization(pid)
      await revoker.query(
        "UPDATE platform_role SET permissions=ARRAY['platform.schedule:read']::text[] WHERE key=$1",
        [role]
      )
      await revoker.query("COMMIT")
      expect(await pending).toMatchObject({
        status: "rejected",
        errorCode: "FORBIDDEN",
        result: null,
      })
      expect(collect).not.toHaveBeenCalled()
      expect((await rows(plan.id))[0]).toMatchObject({
        status: "rejected",
        requestedBy: null,
      })
      const manual = await request(`/${plan.id}/runs`, admin, {
        method: "POST",
      })
      expect(manual.status).toBe(202)
      expect(await manual.json()).toMatchObject({
        status: "rejected",
        errorCode: "FORBIDDEN",
        requestedBy: admin.user.id,
      })
      expect(collect).not.toHaveBeenCalled()
      const denials = await environment.observer.query(
        "SELECT result,fields FROM audit_events WHERE resource_id=$1 AND event_code='platform.schedule_run_rejected'",
        [plan.id]
      )
      expect(denials.rows).toEqual([
        { result: "denied", fields: {} },
        { result: "denied", fields: {} },
      ])
    } finally {
      await revoker.query("ROLLBACK")
      await pending?.catch(() => undefined)
      revoker.release()
      automatic.release()
    }
  })
  it("survives execution connection termination, records INTERRUPTED and keeps HTTP usable", async () => {
    const gate = Promise.withResolvers()
    let connection
    vi.spyOn(monitor, "collect").mockImplementation(async (client) => {
      connection = client
      await gate.promise
      return snapshot
    })
    const plan = await create()
    const response = await request(`/${plan.id}/runs`, admin, {
      method: "POST",
    })
    expect(response.status).toBe(202)
    expect(connection.processID).toBeTypeOf("number")
    try {
      await environment.observer.query("SELECT pg_terminate_backend($1)", [
        connection.processID,
      ])
      await expect
        .poll(
          async () =>
            (
              await environment.observer.query(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=$1) AS present",
                [connection.processID]
              )
            ).rows[0].present
        )
        .toBe(false)
    } finally {
      gate.resolve()
    }
    await start()
    await expect
      .poll(async () => (await rows(plan.id))[0]?.errorCode, { timeout: 5000 })
      .toBe("INTERRUPTED")
    expect((await rows(plan.id))[0]).toMatchObject({
      status: "failed",
      result: null,
    })
    expect((await request("")).status).toBe(200)
  })
  it("survives leader connection termination and acquires a fresh leader session", async () => {
    await start()
    const first = await leaderPid()
    await environment.observer.query("SELECT pg_terminate_backend($1)", [first])
    await expect
      .poll(
        async () => {
          const next = await leaderPid()
          return typeof next === "number" && next !== first
        },
        { timeout: 7000 }
      )
      .toBe(true)
    expect((await request("")).status).toBe(200)
  })
})
