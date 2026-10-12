import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, expect, test } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

let environment, receiver
const signals = []
const previous = {}

beforeAll(async () => {
  receiver = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    signals.push({
      path: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    })
    response.writeHead(200, { "content-type": "application/json" }).end("{}")
  })
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
  for (const [key, value] of Object.entries({
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.address().port}`,
    OTEL_METRIC_EXPORT_INTERVAL: "100",
    OTEL_BSP_SCHEDULE_DELAY: "100",
  })) {
    previous[key] = process.env[key]
    process.env[key] = value
  }
  environment = await startTestApplication()
})

afterAll(async () => {
  await environment?.close()
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (receiver) await new Promise((resolve) => receiver.close(resolve))
})

test("正式 HTTP 将可信请求标识、trace 与 metrics 发到本地接收端且不包含认证秘密", async () => {
  const secret = "telemetry-must-not-export-cookie-secret"
  const response = await fetch(`${environment.baseURL}/api/auth/get-session`, {
    headers: {
      cookie: `test-secret=${secret}`,
      "x-request-id": "untrusted-client-id",
    },
  })
  expect(response.status).toBe(200)
  const requestId = response.headers.get("x-request-id")
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/)
  await expect
    .poll(() => signals.some((signal) => signal.path === "/v1/traces"), {
      timeout: 5000,
    })
    .toBe(true)
  await expect
    .poll(() => signals.some((signal) => signal.path === "/v1/metrics"), {
      timeout: 5000,
    })
    .toBe(true)
  expect(JSON.stringify(signals)).toContain(requestId)
  expect(JSON.stringify(signals)).toContain("http.server.request.duration")
  expect(JSON.stringify(signals)).not.toContain(secret)
  expect(JSON.stringify(signals)).not.toContain("untrusted-client-id")
})

test("真实 Projects 提交与独立 Worker spans 使用同一可信 requestId 且不导出输入或结果正文", async () => {
  const actor = await signUpVerified(
    environment.baseURL,
    "http://localhost:3200",
    environment.migrator
  )
  const organization = await environment.runtime.auth.api.createOrganization({
    headers: actor.headers,
    body: { name: "业务遥测验收", slug: randomUUID() },
  })
  const marker = `private-project-content-${randomUUID()}`
  const csv = `name,description,contentLocale\n${marker},${marker},zh-CN\n`
  const contentBase64 = Buffer.from(csv).toString("base64")
  const submitted = await fetch(
    `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/imports`,
    {
      method: "POST",
      headers: {
        ...Object.fromEntries(actor.headers),
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
        "X-Request-Id": "untrusted-business-request",
      },
      body: JSON.stringify({ format: "csv", contentBase64 }),
    }
  )
  expect(submitted.status).toBe(202)
  const requestId = submitted.headers.get("x-request-id")
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/)
  const task = await submitted.json()
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
  try {
    await expect
      .poll(
        async () => {
          const response = await fetch(
            `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
            { headers: actor.headers }
          )
          expect(response.status).toBe(200)
          return (await response.json()).status
        },
        { timeout: 10000 }
      )
      .toBe("completed")
    const spans = () =>
      signals.flatMap((signal) =>
        (signal.body.resourceSpans ?? []).flatMap((resource) =>
          (resource.scopeSpans ?? []).flatMap((scope) => scope.spans ?? [])
        )
      )
    const attributes = (span) =>
      Object.fromEntries(
        (span.attributes ?? []).map(({ key, value }) => [
          key,
          value.stringValue,
        ])
      )
    await expect
      .poll(
        () =>
          spans().some((span) => {
            const values = attributes(span)
            return (
              values["request.id"] === requestId &&
              values["task.type"] === "projects.import" &&
              values["task.outcome"] === "completed"
            )
          }),
        { timeout: 10000 }
      )
      .toBe(true)
    expect(
      spans().some(
        (span) =>
          attributes(span)["request.id"] === requestId &&
          attributes(span)["http.request.method"] === "POST"
      )
    ).toBe(true)
    const exported = JSON.stringify(signals)
    for (const secret of [
      marker,
      contentBase64,
      actor.cookie,
      actor.user.email,
    ])
      expect(exported).not.toContain(secret)
    expect(exported).not.toContain("untrusted-business-request")
  } finally {
    worker.kill("SIGTERM")
    await closed
  }
})
