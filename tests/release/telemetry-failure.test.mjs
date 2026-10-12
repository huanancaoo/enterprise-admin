import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { resolve } from "node:path"
import { expect, test } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { counterTask } from "../setup/worker-task-fixture.mjs"
import { createTaskTenantRunner } from "../../packages/database/dist/task-tenant.js"
import { shutdownTelemetry } from "../../packages/observability/dist/index.js"

const { createTaskProducer, readWorkerConfig } = createRequire(
  resolve("packages/jobs/package.json")
)("@workspace/jobs")
const { Queue } = createRequire(resolve("packages/jobs/package.json"))("bullmq")

test("真实独立 Worker 的 SQL 失败保留失败与关联标识，OTLP 不导出原错误/输入/结果/状态消息", async () => {
  const resources = new AsyncDisposableStack()
  const signals = []
  const marker = `telemetry-private-SQL-credential-${randomUUID()}`
  const receiver = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    signals.push({
      path: request.url,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    })
    response.writeHead(200, { "content-type": "application/json" }).end("{}")
  })
  await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
  resources.defer(() => new Promise((resolve) => receiver.close(resolve)))
  const telemetryEnv = {
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.address().port}`,
    OTEL_BSP_SCHEDULE_DELAY: "100",
    OTEL_METRIC_EXPORT_INTERVAL: "100",
  }
  const previous = Object.fromEntries(
    Object.keys(telemetryEnv).map((key) => [key, process.env[key]])
  )
  Object.assign(process.env, telemetryEnv)
  resources.defer(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  resources.defer(() => shutdownTelemetry())
  try {
    const environment = await startTestApplication()
    resources.defer(() => environment.close())
    await environment.migrator.query(`
      CREATE TABLE worker_test_resources (organization_id uuid NOT NULL, id uuid NOT NULL, value integer NOT NULL DEFAULT 0, PRIMARY KEY(organization_id,id));
      CREATE TABLE worker_test_receipts (organization_id uuid NOT NULL, actor_id uuid NOT NULL, task_type text NOT NULL, idempotency_key text NOT NULL, intent_fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(organization_id,actor_id,task_type,idempotency_key));
      ALTER TABLE worker_test_resources ENABLE ROW LEVEL SECURITY; ALTER TABLE worker_test_resources FORCE ROW LEVEL SECURITY;
      ALTER TABLE worker_test_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE worker_test_receipts FORCE ROW LEVEL SECURITY;
      CREATE POLICY worker_test_resources_scope ON worker_test_resources USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
      CREATE POLICY worker_test_receipts_scope ON worker_test_receipts USING (organization_id=current_setting('app.organization_id',true)::uuid) WITH CHECK (organization_id=current_setting('app.organization_id',true)::uuid);
      GRANT SELECT,INSERT,UPDATE ON worker_test_resources TO app_runtime; GRANT SELECT,INSERT ON worker_test_receipts TO app_runtime;
    `)
    const origin = "http://localhost:3200"
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: { name: "遥测失败私密验证", slug: randomUUID() },
    })
    const resourceId = randomUUID(),
      requestId = randomUUID()
    await environment.observer.query(
      "INSERT INTO worker_test_resources(organization_id,id) VALUES($1,$2)",
      [organization.id, resourceId]
    )
    const config = {
      ...readWorkerConfig({ REDIS_URL: environment.config.redisURL }),
      queuePrefix: `telemetry-${randomUUID()}`,
      attempts: 2,
      backoffMs: 50,
    }
    const producer = createTaskProducer({
      config,
      registry: [counterTask()],
      runInTenant: createTaskTenantRunner(environment.runtime.pool),
    })
    resources.defer(() => producer.close())
    const redisURL = new URL(environment.config.redisURL)
    const queue = new Queue(config.queueName, {
      connection: { host: redisURL.hostname, port: Number(redisURL.port) },
      prefix: config.queuePrefix,
    })
    resources.defer(() => queue.close())
    const worker = spawn(
      process.execPath,
      ["tests/setup/telemetry-worker-runtime.mjs"],
      {
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: environment.config.databaseURL,
          WORKER_TEST_CONFIG: JSON.stringify(config),
          TELEMETRY_SQL_SECRET: marker,
          ...telemetryEnv,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      }
    )
    let ready = false,
      output = "",
      activeSpan = false,
      sqlFailed = false
    const closed = new Promise((resolve) =>
      worker.once("close", (code) => resolve(code))
    )
    worker.on("message", (message) => {
      if (message.kind === "ready") ready = true
      if (message.kind === "execute") activeSpan = message.activeSpan
      if (message.kind === "sqlFailed") sqlFailed = message.code === "22P02"
    })
    worker.stdout.on("data", (chunk) => {
      output += chunk
    })
    worker.stderr.on("data", (chunk) => {
      output += chunk
    })
    resources.defer(async () => {
      worker.kill("SIGTERM")
      await closed
    })
    await expect
      .poll(() => ready || worker.exitCode !== null, { timeout: 15_000 })
      .toBe(true)
    expect(ready, output).toBe(true)
    const submitted = await producer.submit({
      type: "test.increment",
      input: { amount: 1 },
      idempotencyKey: randomUUID(),
      identity: {
        organizationId: organization.id,
        actorId: actor.user.id,
        resourceId,
        requestId,
        locale: "zh-CN",
      },
    })
    expect(submitted.status).toBe("enqueued")
    await expect
      .poll(async () => (await queue.getJob(submitted.jobId))?.getState(), {
        timeout: 15_000,
      })
      .toBe("failed")
    const failed = await queue.getJob(submitted.jobId)
    expect(failed.failedReason).toBe("EXECUTION_FAILED")
    expect(failed.attemptsMade).toBe(2)
    expect(activeSpan, output).toBe(true)
    expect(sqlFailed).toBe(true)
    expect(
      (
        await environment.observer.query(
          "SELECT value FROM worker_test_resources WHERE id=$1",
          [resourceId]
        )
      ).rows[0].value
    ).toBe(0)
    expect(
      (
        await environment.observer.query(
          "SELECT count(*)::int AS count FROM worker_test_receipts"
        )
      ).rows[0].count
    ).toBe(0)
    worker.kill("SIGTERM")
    expect(await closed).toBe(0)
    await expect
      .poll(() => JSON.stringify(signals).includes('"name":"exception"'), {
        timeout: 5000,
      })
      .toBe(true)
    const exported = JSON.stringify(signals)
    expect(exported).toContain(requestId)
    expect(exported).toContain(submitted.jobId)
    expect(exported).toContain('"key":"error.code"')
    expect(exported).toContain("EXECUTION_FAILED")
    expect(exported).toContain('"key":"task.type"')
    expect(exported).not.toContain(marker)
    expect(exported).not.toContain("exception.stacktrace")
    expect(exported).not.toContain("bullmq.job.failed.reason")
    expect(output).not.toContain(marker)
  } finally {
    await resources.disposeAsync()
  }
})
