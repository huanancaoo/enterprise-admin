import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
const require = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)
const ExcelJS = require("exceljs")

describe("tenant invitation Excel imports", () => {
  const origin = "http://localhost:3200"
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({
      origins: [origin],
      invitationLimits: { organization: 100, actor: 2, ip: 100 },
    })
  })
  afterAll(async () => environment?.close())
  async function fixture() {
    const owner = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "Invitation import", slug: randomUUID() },
    })
    return {
      owner,
      organization,
      url: `${environment.baseURL}/api/v1/organizations/${organization.id}`,
      headers: {
        cookie: owner.cookie,
        origin,
        "content-type": "application/json",
      },
    }
  }
  async function input(emails, role = "member") {
    const book = new ExcelJS.Workbook()
    book
      .addWorksheet("Invitations")
      .addRows([["email"], ...emails.map((email) => [email])])
    return {
      format: "xlsx",
      role,
      contentBase64: Buffer.from(await book.xlsx.writeBuffer()).toString(
        "base64"
      ),
    }
  }
  async function submit(f, body, key = randomUUID()) {
    return fetch(f.url + "/invitations/imports", {
      method: "POST",
      headers: { ...f.headers, "Idempotency-Key": key },
      body: JSON.stringify(body),
    })
  }
  async function withWorker(work) {
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
        INVITATION_ORGANIZATION_HOURLY_LIMIT: String(
          environment.config.invitationLimits.organization
        ),
        INVITATION_ACTOR_HOURLY_LIMIT: String(
          environment.config.invitationLimits.actor
        ),
        INVITATION_IP_HOURLY_LIMIT: String(
          environment.config.invitationLimits.ip
        ),
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
  async function terminal(f, id, status = "completed") {
    await expect
      .poll(
        async () => {
          const response = await fetch(`${f.url}/tasks/${id}`, {
            headers: f.headers,
          })
          expect(response.status).toBe(200)
          return (await response.json()).status
        },
        { timeout: 15000 }
      )
      .toBe(status)
    return (await fetch(`${f.url}/tasks/${id}`, { headers: f.headers })).json()
  }
  async function versionedHeaders(f) {
    const access = await (
      await fetch(f.url + "/access", { headers: f.headers })
    ).json()
    const headers = new Headers(f.owner.headers)
    headers.set("X-Expected-Authz-Version", String(access.authorizationVersion))
    return headers
  }
  it("runs the real Worker, skips existing member/pending/duplicate rows, and retains private row reports", async () => {
    const f = await fixture()
    const member = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: member.user.id,
        role: "member",
      },
    })
    const pendingEmail = `${randomUUID()}@example.test`
    const pending = await environment.runtime.auth.api.createInvitation({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        email: pendingEmail,
        role: "member",
      },
    })
    const fresh = `${randomUUID()}@example.test`
    const body = await input([
      fresh,
      fresh.toUpperCase(),
      member.email,
      pendingEmail,
      "invalid-email",
    ])
    const key = randomUUID()
    const response = await submit(f, body, key)
    expect(response.status, await response.clone().text()).toBe(202)
    const task = await response.json()
    await withWorker(async () => {
      const completed = await terminal(f, task.id)
      expect(completed.result).toEqual({
        count: 1,
        issues: [],
        invitationImport: { invited: 1, skipped: 3, failed: 1 },
      })
      expect(JSON.stringify(completed)).not.toContain(fresh)
      const artifact = await fetch(`${f.url}/tasks/${task.id}/result`, {
        headers: f.headers,
      })
      expect(artifact.status).toBe(200)
      expect(artifact.headers.get("content-type")).toContain("application/json")
      expect(artifact.headers.get("cache-control")).toContain("no-store")
      const report = await artifact.json()
      expect(report.rows.map((row) => row.code)).toEqual([
        "INVITED",
        "DUPLICATE_IN_FILE",
        "MEMBER_ALREADY_EXISTS",
        "INVITATION_ALREADY_PENDING",
        "INVALID_EMAIL",
      ])
      const replay = await submit(f, body, key)
      expect(replay.status).toBe(202)
      expect((await replay.json()).id).toBe(task.id)
      const conflict = await submit(
        f,
        await input([`${randomUUID()}@example.test`]),
        key
      )
      expect(conflict.status).toBe(409)
    })
    await withWorker(async () => {
      await terminal(f, task.id)
    })
    const invitations = await environment.observer.query(
      "SELECT id,email,role,expires_at-created_at AS duration FROM invitation WHERE organization_id=$1 AND email=ANY($2::text[])",
      [f.organization.id, [fresh, pendingEmail]]
    )
    expect(invitations.rows).toHaveLength(2)
    expect(invitations.rows.find((row) => row.email === pendingEmail).id).toBe(
      pending.id
    )
    expect(invitations.rows.every((row) => row.role === "member")).toBe(true)
    const deliveries = await environment.observer.query(
      "SELECT count(*)::int AS count FROM invitation_delivery_attempts WHERE invitation_id=ANY($1::uuid[])",
      [invitations.rows.map((row) => row.id)]
    )
    expect(deliveries.rows[0].count).toBe(2)
    const memberRole = await environment.observer.query(
      "SELECT role FROM member WHERE organization_id=$1 AND user_id=$2",
      [f.organization.id, member.user.id]
    )
    expect(memberRole.rows[0].role).toBe("member")
  })
  it("requires native invitation:create and current role delegation at submission", async () => {
    const f = await fixture()
    const admin = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    await environment.runtime.auth.api.addMember({
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
    const template = await fetch(actor.url + "/invitations/import-template", {
      headers: actor.headers,
    })
    expect(template.status).toBe(200)
    const book = new ExcelJS.Workbook()
    await book.xlsx.load(await template.arrayBuffer())
    expect(book.worksheets[0].getRow(1).values).toEqual([undefined, "email"])
    expect(
      (
        await submit(
          actor,
          await input([`${randomUUID()}@example.test`], "admin")
        )
      ).status
    ).toBe(403)
    expect(
      (await submit(f, await input([`${randomUUID()}@example.test`], "owner")))
        .status
    ).toBe(400)
    await environment.runtime.auth.api.createOrgRole({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        role: "member-editor",
        permission: { member: ["update"] },
      },
    })
    await environment.runtime.auth.api.updateMemberRole({
      headers: await versionedHeaders(f),
      body: {
        organizationId: f.organization.id,
        memberId: (
          await environment.observer.query(
            "SELECT id FROM member WHERE organization_id=$1 AND user_id=$2",
            [f.organization.id, admin.user.id]
          )
        ).rows[0].id,
        role: "member-editor",
      },
    })
    expect(
      (
        await fetch(actor.url + "/invitations/import-template", {
          headers: actor.headers,
        })
      ).status
    ).toBe(403)
    expect(
      (await submit(actor, await input([`${randomUUID()}@example.test`])))
        .status
    ).toBe(403)
  })
  it("rejects a queued import after invitation authority is revoked", async () => {
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
    const email = `${randomUUID()}@example.test`
    const submitted = await submit(actor, await input([email]))
    expect(submitted.status).toBe(202)
    const task = await submitted.json()
    await environment.runtime.auth.api.updateMemberRole({
      headers: await versionedHeaders(f),
      body: {
        organizationId: f.organization.id,
        memberId: membership.id,
        role: "member",
      },
    })
    await withWorker(async () => {
      await terminal(actor, task.id, "rejected")
    })
    const row = await environment.observer.query(
      "SELECT 1 FROM invitation WHERE organization_id=$1 AND email=$2",
      [f.organization.id, email]
    )
    expect(row.rowCount).toBe(0)
    expect(
      (
        await fetch(`${f.url}/tasks/${task.id}/result`, {
          headers: actor.headers,
        })
      ).status
    ).toBe(403)
  })
  it("rechecks invitation authority before downloading a completed report", async () => {
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
    const response = await submit(
      actor,
      await input([`${randomUUID()}@example.test`])
    )
    expect(response.status).toBe(202)
    const task = await response.json()
    await withWorker(async () => {
      await terminal(actor, task.id)
    })
    await environment.runtime.auth.api.updateMemberRole({
      headers: await versionedHeaders(f),
      body: {
        organizationId: f.organization.id,
        memberId: membership.id,
        role: "member",
      },
    })
    expect(
      (
        await fetch(`${f.url}/tasks/${task.id}/result`, {
          headers: actor.headers,
        })
      ).status
    ).toBe(403)
  })
  it("uses the configured shared invitation quota instead of a fixed Worker default", async () => {
    const f = await fixture()
    const response = await submit(
      f,
      await input(
        Array.from({ length: 3 }, () => `${randomUUID()}@example.test`)
      )
    )
    expect(response.status).toBe(202)
    const task = await response.json()
    await withWorker(async () => {
      const completed = await terminal(f, task.id)
      expect(completed.result.invitationImport).toEqual({
        invited: 2,
        skipped: 0,
        failed: 1,
      })
    })
    const report = await (
      await fetch(`${f.url}/tasks/${task.id}/result`, { headers: f.headers })
    ).json()
    expect(report.rows.map((row) => row.code)).toEqual([
      "INVITED",
      "INVITED",
      "INVITATION_RATE_LIMITED",
    ])
  })
})
