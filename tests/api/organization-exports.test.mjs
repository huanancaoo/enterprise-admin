import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { recordBusinessTaskProgress } from "../../packages/jobs/src/business-task-progress.ts"
const require = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)
const ExcelJS = require("exceljs")

describe("tenant organization exports", () => {
  const origin = "http://localhost:3200"
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
  })
  afterAll(async () => environment?.close())
  async function withWorker(work) {
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: "ignore",
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    try {
      return await work()
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  }
  async function fixture() {
    const owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Organization export", slug: randomUUID() },
    })
    const url = `${environment.baseURL}/api/v1/organizations/${organization.id}`
    const headers = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    return { owner, organization, url, headers }
  }
  async function submit(f, path, body) {
    const response = await fetch(f.url + path, {
      method: "POST",
      headers: { ...f.headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify(body),
    })
    expect(response.status, await response.clone().text()).toBe(202)
    return response.json()
  }
  async function complete(f, task) {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${f.url}/tasks/${task.id}`, {
            headers: f.headers,
          })
          expect(response.status).toBe(200)
          return (await response.json()).status
        },
        { timeout: 15000 }
      )
      .toBe("completed")
    const response = await fetch(`${f.url}/tasks/${task.id}/result`, {
      headers: f.headers,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toContain("no-store")
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await response.arrayBuffer())
    return workbook.worksheets[0].getSheetValues()
  }
  it("exports the filter through the real Worker with platform identities redacted", async () => {
    const f = await fixture()
    const user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      { name: "Exported member" }
    )
    await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: user.user.id,
        role: "member",
      },
    })
    const actor = randomUUID(),
      resource = randomUUID()
    await environment.observer.query(
      `INSERT INTO audit_events(organization_id,actor_id,event_code,scope,tenant_visible,resource_type,resource_id,public_summary,fields,request_id) VALUES($1,$2,'platform.organization_suspended','platform',true,'organization',$3,'Organization suspended',$4,'organization-export-test')`,
      [f.organization.id, actor, resource, { reason: "not-exportable" }]
    )
    const listed = await fetch(f.url + "/audit-events", { headers: f.headers })
    expect(listed.status).toBe(200)
    const page = await listed.json()
    const audit = await submit(f, "/audit-events/exports", {
      format: "xlsx",
      filter: { ...page.window, eventCode: "platform.organization_suspended" },
    })
    const members = await submit(f, "/members/exports", {
      format: "xlsx",
      filter: { q: "Exported member", sortBy: "createdAt", sortOrder: "desc" },
    })
    await withWorker(async () => {
      const logs = await complete(f, audit)
      expect(JSON.stringify(logs)).toContain("Organization suspended")
      for (const secret of [actor, resource, "not-exportable"])
        expect(JSON.stringify(logs)).not.toContain(secret)
      const rows = await complete(f, members)
      expect(JSON.stringify(rows)).toContain(user.email)
      expect(rows).toHaveLength(3)
    })
  })
  it("separates read and export permissions and confines member options to the current organization", async () => {
    const f = await fixture()
    const reader = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.runtime.auth.api.createOrgRole({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        role: "audit-reader",
        permission: { audit: ["read"] },
      },
    })
    await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: reader.user.id,
        role: "audit-reader",
      },
    })
    const headers = {
      cookie: reader.cookie,
      origin,
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    }
    const page = await (
      await fetch(f.url + "/audit-events", { headers })
    ).json()
    for (const [path, body] of [
      ["/audit-events/exports", { format: "xlsx", filter: page.window }],
      ["/members/exports", { format: "xlsx", filter: {} }],
    ]) {
      const response = await fetch(f.url + path, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      })
      expect(response.status).toBe(403)
    }
    const options = await fetch(
      f.url + `/member-options?userId=${reader.user.id}`,
      { headers }
    )
    expect(options.status).toBe(200)
    expect((await options.json()).items).toEqual([
      { userId: reader.user.id, name: reader.user.name },
    ])
    const byEmail = await fetch(
      f.url + `/member-options?q=${encodeURIComponent(reader.email)}`,
      { headers }
    )
    expect(byEmail.status).toBe(200)
    expect((await byEmail.json()).items).toEqual([])
    const membershipOnly = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: membershipOnly.user.id,
        role: "member",
      },
    })
    const noAudit = await fetch(f.url + "/member-options", {
      headers: { cookie: membershipOnly.cookie, origin },
    })
    expect(noAudit.status).toBe(403)
    const other = await fixture()
    const denied = await fetch(
      other.url + `/member-options?userId=${other.owner.user.id}`,
      { headers }
    )
    expect(denied.status).toBe(403)
  })
  it("rechecks export permission before downloading an already completed result", async () => {
    const f = await fixture()
    const admin = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const membership = await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: admin.user.id,
        role: "admin",
      },
    })
    const actor = {
      ...f,
      headers: {
        cookie: admin.cookie,
        origin,
        "content-type": "application/json",
      },
    }
    const task = await submit(actor, "/members/exports", {
      format: "xlsx",
      filter: {},
    })
    await withWorker(() => complete(actor, task))
    const versionHeaders = new Headers(f.owner.headers)
    const access = await (
      await fetch(f.url + "/access", { headers: f.headers })
    ).json()
    versionHeaders.set(
      "X-Expected-Authz-Version",
      String(access.authorizationVersion)
    )
    await environment.runtime.auth.api.updateMemberRole({
      headers: versionHeaders,
      body: {
        organizationId: f.organization.id,
        memberId: membership.id,
        role: "member",
      },
    })
    const denied = await fetch(`${f.url}/tasks/${task.id}/result`, {
      headers: actor.headers,
    })
    expect(denied.status).toBe(403)
  })
  async function progressFixture() {
    const f = await fixture()
    const task = await submit(f, "/members/exports", {
      format: "xlsx",
      filter: {},
    })
    const stored = await environment.observer.query(
      "SELECT intent_fingerprint, job_id FROM business_tasks WHERE id=$1",
      [task.id]
    )
    const membership = await environment.observer.query(
      "SELECT id FROM member WHERE organization_id=$1 AND user_id=$2",
      [f.organization.id, f.owner.user.id]
    )
    const binding = {
      organizationId: f.organization.id,
      actorId: f.owner.user.id,
      resourceId: task.id,
      intentFingerprint: stored.rows[0].intent_fingerprint,
    }
    const context = {
      organizationId: f.organization.id,
      userId: f.owner.user.id,
      membershipId: membership.rows[0].id,
      requestId: randomUUID(),
      locale: "zh-CN",
    }
    return {
      ...f,
      task,
      context,
      jobId: stored.rows[0].job_id,
      record: (observation) =>
        recordBusinessTaskProgress(
          environment.runtime.pool,
          binding,
          observation
        ),
      async read() {
        const response = await fetch(`${f.url}/tasks/${task.id}`, {
          headers: f.headers,
        })
        expect(response.status).toBe(200)
        return response.json()
      },
    }
  }

  it("keeps submission acknowledgements distinct from recovery and ignores late observations", async () => {
    const f = await progressFixture()
    const active = { status: "already_exists", state: "active", jobId: f.jobId }
    await f.record({ kind: "submission", context: f.context, outcome: active })
    expect((await f.read()).status).toBe("queued")
    await f.record({ kind: "recovery", outcome: active })
    expect((await f.read()).status).toBe("running")
    const enqueued = { status: "enqueued", jobId: f.jobId }
    await f.record({
      kind: "submission",
      context: f.context,
      outcome: enqueued,
    })
    await f.record({ kind: "recovery", outcome: enqueued })
    expect((await f.read()).status).toBe("running")
    const failed = {
      status: "already_exists",
      state: "failed",
      failureCode: "PERMISSION_DENIED",
      jobId: f.jobId,
    }
    await f.record({ kind: "submission", context: f.context, outcome: failed })
    expect((await f.read()).status).toBe("running")
    await f.record({ kind: "recovery", outcome: failed })
    await f.record({ kind: "recovery", outcome: failed })
    await f.record({ kind: "worker-active" })
    await f.record({
      kind: "worker-failed",
      unrecoverable: false,
      failedReason: "EXECUTION_FAILED",
    })
    expect(await f.read()).toMatchObject({
      status: "rejected",
      errorCode: "PERMISSION_DENIED",
    })
    const audit = await environment.observer.query(
      "SELECT event_code FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_code IN ('task.rejected','task.failed')",
      [f.organization.id, f.task.id]
    )
    expect(audit.rows).toEqual([{ event_code: "task.rejected" }])
  })

  it("requires an active organization for a submission acknowledgement but still records its permanent rejection", async () => {
    const f = await progressFixture()
    await environment.migrator.query(
      "UPDATE organization_status SET status='SUSPENDED' WHERE organization_id=$1",
      [f.organization.id]
    )
    await expect(
      f.record({
        kind: "submission",
        context: f.context,
        outcome: { status: "enqueued", jobId: f.jobId },
      })
    ).rejects.toMatchObject({ cause: { code: "ORS02" } })
    const stored = () =>
      environment.observer.query(
        "SELECT status, error_code FROM business_tasks WHERE id=$1",
        [f.task.id]
      )
    expect((await stored()).rows).toEqual([
      { status: "queued", error_code: null },
    ])
    await f.record({
      kind: "permanent-rejection",
      code: "ORGANIZATION_SUSPENDED",
    })
    expect((await stored()).rows).toEqual([
      {
        status: "rejected",
        error_code: "ORGANIZATION_SUSPENDED",
      },
    ])
  })

  it.each([
    [true, "rejected"],
    [false, "failed"],
  ])(
    "settles a Worker failure using its unrecoverable flag %s as %s",
    async (unrecoverable, status) => {
      const f = await progressFixture()
      await f.record({ kind: "worker-active" })
      expect((await f.read()).status).toBe("running")
      await f.record({
        kind: "worker-failed",
        unrecoverable,
        failedReason: "TOO_MANY_ROWS",
      })
      expect(await f.read()).toMatchObject({
        status,
        errorCode: "TOO_MANY_ROWS",
      })
    }
  )

  it.each([
    ["TOO_MANY_ROWS", "rejected"],
    ["PERMISSION_DENIED", "rejected"],
    ["EXECUTION_FAILED", "failed"],
  ])(
    "recovers %s once as %s after a Worker observation is lost",
    async (code, status) => {
      const f = await progressFixture()
      const task = f.task
      const transition = () =>
        f.record({
          kind: "recovery",
          outcome: {
            status: "already_exists",
            state: "failed",
            failureCode: code,
            jobId: f.jobId,
          },
        })
      await transition()
      await transition()
      const response = await fetch(`${f.url}/tasks/${task.id}`, {
        headers: f.headers,
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        status,
        errorCode: code,
        resultAvailable: false,
      })
      const facts = await environment.observer.query(
        "SELECT event_code FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_code=$3",
        [f.organization.id, task.id, `task.${status}`]
      )
      expect(facts.rowCount).toBe(1)
    }
  )
})
