import { spawn } from "node:child_process"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const {
  WebhookDelivery,
} = require("../../apps/api/dist/webhooks/webhook-delivery.js")
import { createServer } from "node:http"
import { randomUUID, webcrypto } from "node:crypto"
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest"
import {
  CreatedWebhookSchema,
  WebhookListSchema,
  WebhookSchema,
  WebhookDeliveryPageSchema,
} from "../../packages/contracts/dist/index.js"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("组织Webhook公开HTTP", () => {
  let environment
  let actor
  let organizationId
  let worker, workerClosed
  const origin = "http://localhost:3200"
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin] })
    environment.app.get(WebhookDelivery).start()
    actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const created = await fetch(
      `${environment.baseURL}/api/auth/organization/create`,
      {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Webhook组织",
          slug: `webhook-${actor.user.id}`,
        }),
      }
    )
    expect(created.status).toBe(200)
    organizationId = (await created.json()).id
    worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    workerClosed = new Promise((resolve) => worker.once("exit", resolve))
  })
  afterAll(async () => {
    worker?.kill("SIGTERM")
    await workerClosed
    await environment?.close()
  })
  it("拥有integration管理权限的成员创建订阅，签名密钥只在创建响应出现", async () => {
    const url = `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks`
    const response = await fetch(url, {
      method: "POST",
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "项目事件",
        url: "http://127.0.0.1:9/events",
        events: ["project.created"],
      }),
    })
    expect(response.status).toBe(201)
    const created = CreatedWebhookSchema.parse(await response.json())
    expect(created.signingSecret.startsWith("whsec_")).toBe(true)
    expect(Buffer.from(created.signingSecret.slice(6), "base64").length).toBe(
      32
    )
    const list = await fetch(url, { headers: actor.headers })
    expect(list.status).toBe(200)
    const items = WebhookListSchema.parse(await list.json())
    expect(items.map((item) => item.id)).toContain(created.id)
    expect(Object.hasOwn(items[0], "signingSecret")).toBe(false)
    expect(
      (
        await fetch(`${url}/${created.id}`, {
          method: "DELETE",
          headers: actor.headers,
        })
      ).status
    ).toBe(204)
  })
  it("管理者更新订阅并关闭投递，查询空投递记录后删除订阅", async () => {
    const path = `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks`
    const headers = {
      cookie: actor.cookie,
      origin,
      "content-type": "application/json",
    }
    const created = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "待管理",
        url: "http://127.0.0.1:9/events",
        events: ["task.completed"],
      }),
    })
    const item = CreatedWebhookSchema.parse(await created.json())
    const update = await fetch(`${path}/${item.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        name: "已关闭",
        url: "http://127.0.0.1:9/updated",
        events: ["task.failed"],
        enabled: false,
      }),
    })
    expect(update.status).toBe(200)
    const changed = WebhookSchema.parse(await update.json())
    expect(changed).toMatchObject({
      name: "已关闭",
      enabled: false,
      events: ["task.failed"],
    })
    expect(Object.hasOwn(changed, "signingSecret")).toBe(false)
    const history = await fetch(`${path}/${item.id}/deliveries`, {
      headers: actor.headers,
    })
    expect(history.status).toBe(200)
    expect(WebhookDeliveryPageSchema.parse(await history.json())).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    })
    expect(
      (await fetch(`${path}/${item.id}`, { method: "DELETE", headers })).status
    ).toBe(204)
    expect(
      (await fetch(`${path}/${item.id}/deliveries`, { headers: actor.headers }))
        .status
    ).toBe(404)
  })
  it("持久投递意图到真实HTTP接收端，使用稳定eventId与可独立验证的Standard Webhooks签名", async () => {
    const received = []
    const receiver = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      received.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      })
      response.writeHead(204).end()
    })
    await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
    try {
      const target = `http://127.0.0.1:${receiver.address().port}/events`
      const path = `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks`
      const createdResponse = await fetch(path, {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "任务结果",
          url: target,
          events: ["task.completed"],
        }),
      })
      const endpoint = CreatedWebhookSchema.parse(await createdResponse.json())
      const projectPath = `${environment.baseURL}/api/v1/organizations/${organizationId}/projects`
      for (let index = 0; index < 3; index++) {
        const created = await fetch(projectPath, {
          method: "POST",
          headers: {
            ...Object.fromEntries(actor.headers),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: `Webhook fixture ${index}`,
            description: null,
          }),
        })
        expect(created.status).toBe(201)
      }
      const submitted = await fetch(`${projectPath}/exports`, {
        method: "POST",
        headers: {
          ...Object.fromEntries(actor.headers),
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          format: "csv",
          filter: { name: "Webhook fixture" },
        }),
      })
      expect(submitted.status).toBe(202)
      const id = (await submitted.json()).id
      await vi.waitFor(() => expect(received).toHaveLength(1), {
        timeout: 3000,
        interval: 30,
      })
      const message = received[0]
      const body = JSON.parse(message.body)
      expect(body).toEqual({
        id: expect.any(String),
        type: "task.completed",
        organizationId,
        resourceId: id,
        occurredAt: expect.any(String),
        data: {
          taskType: "projects.export",
          status: "completed",
          count: 3,
          errorCode: null,
        },
      })
      expect(message.headers["webhook-id"]).toBe(body.id)
      const timestamp = message.headers["webhook-timestamp"]
      expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(5)
      const key = await webcrypto.subtle.importKey(
        "raw",
        Buffer.from(endpoint.signingSecret.slice(6), "base64"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      )
      const signature = message.headers["webhook-signature"]
      expect(signature.startsWith("v1,")).toBe(true)
      expect(
        await webcrypto.subtle.verify(
          "HMAC",
          key,
          Buffer.from(signature.slice(3), "base64"),
          Buffer.from(`${body.id}.${timestamp}.${message.body}`)
        )
      ).toBe(true)
      await vi.waitFor(
        async () => {
          const history = WebhookDeliveryPageSchema.parse(
            await (
              await fetch(`${path}/${endpoint.id}/deliveries`, {
                headers: actor.headers,
              })
            ).json()
          )
          expect(history.items).toHaveLength(1)
          expect(history.items[0]).toMatchObject({
            eventId: body.id,
            status: "delivered",
            attempts: 1,
            lastStatusCode: 204,
          })
        },
        { timeout: 3000 }
      )
    } finally {
      await new Promise((resolve) => receiver.close(resolve))
    }
  })
  async function projectEvent(headers = actor.headers) {
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organizationId}/projects`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: `Delivery event ${randomUUID()}`,
          description: null,
        }),
      }
    )
    expect(response.status).toBe(201)
  }
  async function subscribe(target, headers = actor.headers) {
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(headers),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Controlled receiver",
          url: target,
          events: ["project.created"],
        }),
      }
    )
    expect(response.status).toBe(201)
    return response.json()
  }
  const history = (id) =>
    fetch(
      `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks/${id}/deliveries`,
      { headers: actor.headers }
    ).then((response) => response.json())
  async function remove(id) {
    await fetch(
      `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks/${id}`,
      { method: "DELETE", headers: actor.headers }
    )
  }
  it("非2xx按有界退避保留同一事件身份，耗尽后不再尝试", async () => {
    await environment.app.get(WebhookDelivery).stop()
    const messages = []
    const receiver = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      messages.push({
        at: Date.now(),
        id: request.headers["webhook-id"],
        body: Buffer.concat(chunks).toString(),
      })
      response.writeHead(503).end()
    })
    await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
    let endpoint
    try {
      endpoint = await subscribe(`http://127.0.0.1:${receiver.address().port}`)
      await projectEvent()
      for (let attempt = 1; attempt <= 3; attempt++) {
        await vi.waitFor(
          async () => {
            const record = (await history(endpoint.id)).items[0]
            expect(
              record.nextAttemptAt === null ||
                Date.parse(record.nextAttemptAt) <= Date.now()
            ).toBe(true)
          },
          { timeout: 5000 }
        )
        expect(await environment.app.get(WebhookDelivery).dispatchOne()).toBe(
          true
        )
        expect(messages).toHaveLength(attempt)
      }
      const item = (await history(endpoint.id)).items[0]
      expect(item).toMatchObject({
        status: "failed",
        attempts: 3,
        lastStatusCode: 503,
        nextAttemptAt: null,
      })
      expect(new Set(messages.map((message) => message.id)).size).toBe(1)
      expect(new Set(messages.map((message) => message.body)).size).toBe(1)
      expect(messages[1].at - messages[0].at).toBeGreaterThanOrEqual(900)
      expect(messages[2].at - messages[1].at).toBeGreaterThanOrEqual(1900)
      expect(await environment.app.get(WebhookDelivery).dispatchOne()).toBe(
        false
      )
      expect(messages).toHaveLength(3)
    } finally {
      if (endpoint) await remove(endpoint.id)
      await new Promise((resolve) => receiver.close(resolve))
    }
  })
  it("creator撤权永久拒绝既有投递，恢复角色不重投", async () => {
    await environment.app.get(WebhookDelivery).stop()
    const creator = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const role = (
      await environment.runtime.auth.api.createOrgRole({
        headers: actor.headers,
        body: {
          organizationId,
          role: `delivery-${randomUUID().slice(0, 8)}`,
          permission: { integration: ["read", "manage"] },
        },
      })
    ).roleData
    await environment.runtime.auth.api.addMember({
      headers: actor.headers,
      body: { organizationId, userId: creator.user.id, role: role.role },
    })
    let requests = 0
    const receiver = createServer((_request, response) => {
      requests++
      response.writeHead(204).end()
    })
    await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
    let endpoint
    try {
      endpoint = await subscribe(
        `http://127.0.0.1:${receiver.address().port}`,
        creator.headers
      )
      await projectEvent()
      const change = async (permission) => {
        const headers = new Headers(actor.headers)
        const result = await environment.observer.query(
          "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
          [organizationId]
        )
        headers.set(
          "X-Expected-Authz-Version",
          String(result.rows[0].authorization_version)
        )
        await environment.runtime.auth.api.updateOrgRole({
          headers,
          body: { organizationId, roleId: role.id, data: { permission } },
        })
      }
      await change({ integration: ["read"] })
      expect(await environment.app.get(WebhookDelivery).dispatchOne()).toBe(
        true
      )
      expect((await history(endpoint.id)).items[0]).toMatchObject({
        status: "failed",
        lastStatusCode: null,
        nextAttemptAt: null,
      })
      expect(requests).toBe(0)
      await change({ integration: ["read", "manage"] })
      expect(await environment.app.get(WebhookDelivery).dispatchOne()).toBe(
        false
      )
      expect(requests).toBe(0)
    } finally {
      if (endpoint) await remove(endpoint.id)
      await new Promise((resolve) => receiver.close(resolve))
    }
  })
  it("停用订阅终止已存在的计划，不发送到接收端", async () => {
    await environment.app.get(WebhookDelivery).stop()
    let requests = 0
    const receiver = createServer((_request, response) => {
      requests++
      response.writeHead(204).end()
    })
    await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
    let endpoint
    try {
      const url = `http://127.0.0.1:${receiver.address().port}`
      endpoint = await subscribe(url)
      await projectEvent()
      const response = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organizationId}/webhooks/${endpoint.id}`,
        {
          method: "PUT",
          headers: {
            ...Object.fromEntries(actor.headers),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Disabled",
            url,
            events: ["project.created"],
            enabled: false,
          }),
        }
      )
      expect(response.status).toBe(200)
      expect(await environment.app.get(WebhookDelivery).dispatchOne()).toBe(
        true
      )
      expect((await history(endpoint.id)).items[0]).toMatchObject({
        status: "failed",
        lastStatusCode: null,
      })
      expect(requests).toBe(0)
    } finally {
      if (endpoint) await remove(endpoint.id)
      await new Promise((resolve) => receiver.close(resolve))
    }
  })
})
