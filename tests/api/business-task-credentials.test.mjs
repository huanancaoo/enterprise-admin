import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("单个业务任务的调用凭据读取", () => {
  const origin = "http://localhost:3200"
  let environment
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
  })
  afterAll(async () => environment?.close())
  it("project.export 凭据读取已有导出任务，聚合目录继续要求 Cookie", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const organization = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "程序读取任务", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${organization.id}`
    const cookieHeaders = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    const submission = await fetch(`${url}/projects/exports`, {
      method: "POST",
      headers: { ...cookieHeaders, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ format: "csv", filter: {} }),
    })
    expect(submission.status).toBe(202)
    const task = await submission.json()
    const issuance = await fetch(`${url}/access-credentials`, {
      method: "POST",
      headers: cookieHeaders,
      body: JSON.stringify({
        name: "Poll exports",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        permissions: { project: ["export"] },
      }),
    })
    expect(issuance.status).toBe(201)
    const credential = await issuance.json()
    const headers = { "x-api-key": credential.key }
    const read = await fetch(`${url}/tasks/${task.id}`, { headers })
    expect(read.status).toBe(200)
    const metadata = await read.json()
    expect({
      id: metadata.id,
      type: metadata.type,
      actorId: metadata.actorId,
    }).toEqual({ id: task.id, type: "projects.export", actorId: owner.user.id })
    for (const path of ["/tasks", "/task-center"]) {
      const aggregate = await fetch(url + path, { headers })
      expect(aggregate.status).toBe(401)
    }
  })
  it("project.export 凭据下载真实 Worker 产物", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "程序下载结果", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}`
    const cookieHeaders = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    const submitted = await fetch(`${url}/projects/exports`, {
      method: "POST",
      headers: { ...cookieHeaders, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ format: "csv", filter: {} }),
    })
    expect(submitted.status).toBe(202)
    const task = await submitted.json()
    const issued = await fetch(`${url}/access-credentials`, {
      method: "POST",
      headers: cookieHeaders,
      body: JSON.stringify({
        name: "Download result",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        permissions: { project: ["export"] },
      }),
    })
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "ignore", "ignore"],
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    try {
      await expect
        .poll(
          async () => {
            const read = await fetch(`${url}/tasks/${task.id}`, {
              headers: { cookie: owner.cookie },
            })
            expect(read.status).toBe(200)
            return (await read.json()).status
          },
          { timeout: 10_000 }
        )
        .toBe("completed")
      const result = await fetch(`${url}/tasks/${task.id}/result`, {
        headers: { "x-api-key": credential.key },
      })
      expect(result.status).toBe(200)
      expect(result.headers.get("content-type")).toContain("text/csv")
      expect(result.headers.get("cache-control")).toContain("no-store")
      expect(await result.text()).toContain("name,description,contentLocale")
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  })
  it("导入任务按 project.create 授权，export/read scope 不能读取", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "导入scope", slug: randomUUID() },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}`
    const headers = {
      cookie: owner.cookie,
      origin,
      "content-type": "application/json",
    }
    const imported = await fetch(`${url}/projects/imports`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        format: "csv",
        contentBase64: Buffer.from(
          "name,description,contentLocale\nImport project,Scope test,zh-CN\n"
        ).toString("base64"),
      }),
    })
    expect(imported.status).toBe(202)
    const task = await imported.json()
    for (const action of ["create", "export", "read"]) {
      const issued = await fetch(`${url}/access-credentials`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `Import ${action}`,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          permissions: { project: [action] },
        }),
      })
      expect(issued.status).toBe(201)
      const credential = await issued.json()
      const read = await fetch(`${url}/tasks/${task.id}`, {
        headers: { "x-api-key": credential.key },
      })
      expect(read.status).toBe(action === "create" ? 200 : 403)
      if (action !== "create") {
        const result = await fetch(`${url}/tasks/${task.id}/result`, {
          headers: { "x-api-key": credential.key },
        })
        expect(result.status).toBe(403)
      }
    }
  })
  it("原动作撤权后 Cookie 本人状态可读，凭据与产物均拒绝", async () => {
    const { baseURL, migrator, runtime } = environment
    const owner = await signUpVerified(baseURL, origin, migrator)
    const actor = await signUpVerified(baseURL, origin, migrator)
    const org = await runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "本人任务历史", slug: randomUUID() },
    })
    const role = (
      await runtime.auth.api.createOrgRole({
        headers: owner.headers,
        body: {
          organizationId: org.id,
          role: `poll-${randomUUID().slice(0, 8)}`,
          permission: { integration: ["manage"], project: ["export"] },
        },
      })
    ).roleData
    await runtime.auth.api.addMember({
      headers: owner.headers,
      body: { organizationId: org.id, userId: actor.user.id, role: role.role },
    })
    const url = `${baseURL}/api/v1/organizations/${org.id}`
    const headers = {
      cookie: actor.cookie,
      origin,
      "content-type": "application/json",
    }
    const submission = await fetch(`${url}/projects/exports`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({ format: "csv", filter: {} }),
    })
    expect(submission.status).toBe(202)
    const task = await submission.json()
    const issued = await fetch(`${url}/access-credentials`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Revoked role polling",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        permissions: { project: ["export"] },
      }),
    })
    expect(issued.status).toBe(201)
    const credential = await issued.json()
    const access = await fetch(`${url}/access`, {
      headers: { cookie: owner.cookie },
    })
    expect(access.status).toBe(200)
    const version = (await access.json()).authorizationVersion
    const ownerHeaders = new Headers(owner.headers)
    ownerHeaders.set("X-Expected-Authz-Version", String(version))
    await runtime.auth.api.updateOrgRole({
      headers: ownerHeaders,
      body: {
        organizationId: org.id,
        roleId: role.id,
        data: { permission: { integration: ["manage"], project: ["read"] } },
      },
    })
    const cookieRead = await fetch(`${url}/tasks/${task.id}`, {
      headers: { cookie: actor.cookie },
    })
    expect(cookieRead.status).toBe(200)
    const keyRead = await fetch(`${url}/tasks/${task.id}`, {
      headers: { "x-api-key": credential.key },
    })
    expect(keyRead.status).toBe(403)
    for (const authorization of [
      { cookie: actor.cookie },
      { "x-api-key": credential.key },
    ]) {
      const result = await fetch(`${url}/tasks/${task.id}/result`, {
        headers: authorization,
      })
      expect(result.status).toBe(403)
    }
  })
})
