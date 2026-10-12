import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { randomUUID, webcrypto } from "node:crypto"
import { expect, test } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"

test("生产启动入口自动消费业务终态并向批准的本地 SMTP/Webhook 接收端投递薄载荷", async () => {
  const resources = new AsyncDisposableStack()
  const received = []
  const receiver = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received.push({
      headers: request.headers,
      raw: Buffer.concat(chunks).toString(),
    })
    response.writeHead(204).end()
  })
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
  resources.defer(() => new Promise((resolve) => receiver.close(resolve)))
  try {
    const environment = await startTestApplication({
      mail: true,
      businessDeliveries: true,
    })
    resources.defer(() => environment.close())
    const actor = await signUpVerified(
      environment.baseURL,
      "http://localhost:3200",
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "自动投递验收", slug: randomUUID() },
    })
    const path = `${environment.baseURL}/api/v1/organizations/${organization.id}`
    const headers = {
      ...Object.fromEntries(actor.headers),
      "content-type": "application/json",
    }
    const preference = await fetch(`${path}/notification-preferences`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ emailEnabled: true }),
    })
    expect(preference.status).toBe(200)
    const subscription = await fetch(`${path}/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "本地接收端",
        url: `http://127.0.0.1:${receiver.address().port}/events`,
        events: ["task.completed"],
      }),
    })
    expect(subscription.status).toBe(201)
    const endpoint = await subscription.json()
    const marker = `private-project-${randomUUID()}`
    const submit = await fetch(`${path}/projects/imports`, {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": randomUUID() },
      body: JSON.stringify({
        format: "csv",
        contentBase64: Buffer.from(
          `name,description,contentLocale\n${marker},${marker},zh-CN\n`
        ).toString("base64"),
      }),
    })
    expect(submit.status).toBe(202)
    const task = await submit.json()
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    worker.stdout.resume()
    worker.stderr.resume()
    resources.defer(async () => {
      worker.kill("SIGTERM")
      await closed
    })
    await expect.poll(() => received.length, { timeout: 15000 }).toBe(1)
    const event = JSON.parse(received[0].raw)
    expect(event).toMatchObject({
      type: "task.completed",
      organizationId: organization.id,
      resourceId: task.id,
      data: { status: "completed", count: 1 },
    })
    expect(Object.keys(event).sort()).toEqual([
      "data",
      "id",
      "occurredAt",
      "organizationId",
      "resourceId",
      "type",
    ])
    const key = await webcrypto.subtle.importKey(
      "raw",
      Buffer.from(endpoint.signingSecret.slice(6), "base64"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    )
    const signature = Buffer.from(
      received[0].headers["webhook-signature"].slice(3),
      "base64"
    )
    const signed = new TextEncoder().encode(
      `${event.id}.${received[0].headers["webhook-timestamp"]}.${received[0].raw}`
    )
    expect(await webcrypto.subtle.verify("HMAC", key, signature, signed)).toBe(
      true
    )
    const email = await waitForMail(
      environment.mailpitOrigin,
      actor.email,
      "任务已完成"
    )
    const target = new URL(firstHttpUrl(email.HTML))
    expect(target.pathname).toBe(`/app/tasks/${organization.id}`)
    expect(target.searchParams.get("taskId")).toBe(task.id)
    expect(email.To.map((to) => to.Address)).toEqual([actor.email])
    expect(received[0].raw).not.toContain(marker)
    expect(email.HTML + email.Text).not.toContain(marker)
    const notifications = await fetch(`${path}/notifications`, {
      headers: actor.headers,
    })
    expect((await notifications.json()).items).toHaveLength(1)
    await expect
      .poll(async () => {
        const rows = await environment.observer.query(
          "SELECT email_status FROM business_notifications WHERE task_id=$1",
          [task.id]
        )
        return rows.rows[0]?.email_status
      })
      .toBe("sent")
  } finally {
    await resources.disposeAsync()
  }
})
