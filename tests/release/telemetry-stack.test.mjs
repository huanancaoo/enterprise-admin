import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, expect, test } from "vitest"
import { shutdownTelemetry } from "../../packages/observability/dist/index.js"
import { startTestApplication } from "../setup/test-runtime.mjs"
beforeAll(() =>
  execFileSync(process.execPath, ["infra/release/build-base-images.mjs"], {
    stdio: ["ignore", "ignore", "pipe"],
  })
)

async function port() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}

test("正式HTTP经本地Collector到达Prometheus指标与Jaeger关联trace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telemetry-stack-"))
  const project = "telemetry-" + randomBytes(6).toString("hex")
  const file = join(directory, "release.env")
  const env = {
    POSTGRES_PASSWORD: randomBytes(32).toString("hex"),
    APP_MIGRATOR_PASSWORD: randomBytes(32).toString("hex"),
    APP_RUNTIME_PASSWORD: randomBytes(32).toString("hex"),
    PLATFORM_RUNTIME_PASSWORD: randomBytes(32).toString("hex"),
    PLATFORM_DEPLOYER_PASSWORD: randomBytes(32).toString("hex"),
    MIGRATION_DATABASE_URL:
      "postgresql://not-started:not-started@postgres/enterprise_admin",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    EMAIL_PAYLOAD_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    GITHUB_CLIENT_ID: "not-started",
    GITHUB_CLIENT_SECRET: randomBytes(32).toString("hex"),
    RELEASE_TENANT_ORIGIN: "http://127.0.0.1:1",
    RELEASE_PLATFORM_ORIGIN: "http://127.0.0.1:2",
    RELEASE_TENANT_PORT: "1",
    RELEASE_PLATFORM_PORT: "2",
    RELEASE_MAIL_PORT: "3",
    RELEASE_API_IMAGE: "not-started",
    RELEASE_WORKER_IMAGE: "not-started",
    RELEASE_TENANT_IMAGE: "not-started",
    RELEASE_PLATFORM_IMAGE: "not-started",
    RELEASE_MIGRATOR_IMAGE: "not-started",
    RELEASE_PROMETHEUS_PORT: String(await port()),
    RELEASE_TRACING_PORT: String(await port()),
    RELEASE_OTLP_PORT: String(await port()),
  }
  await writeFile(
    file,
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
  const compose = (...args) =>
    execFileSync(
      "docker",
      [
        "compose",
        "-p",
        project,
        "--env-file",
        file,
        "-f",
        "compose.release.yaml",
        ...args,
      ],
      { encoding: "utf8" }
    )
  let environment
  const previous = { ...process.env }
  try {
    compose("up", "-d", "otel-collector", "prometheus", "tracing")
    await expect
      .poll(
        async () => {
          try {
            return (
              await fetch(
                `http://127.0.0.1:${env.RELEASE_PROMETHEUS_PORT}/-/ready`
              )
            ).status
          } catch {
            return 0
          }
        },
        { timeout: 30_000 }
      )
      .toBe(200)
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${env.RELEASE_OTLP_PORT}`
    process.env.OTEL_METRIC_EXPORT_INTERVAL = "1000"
    process.env.OTEL_BSP_SCHEDULE_DELAY = "100"
    environment = await startTestApplication()
    const response = await fetch(`${environment.baseURL}/api/auth/get-session`)
    expect(response.status).toBe(200)
    const requestId = response.headers.get("x-request-id")
    await expect
      .poll(
        async () => {
          const result = await fetch(
            `http://127.0.0.1:${env.RELEASE_PROMETHEUS_PORT}/api/v1/query?query=${encodeURIComponent('http_server_request_duration_seconds_count{service_name="enterprise-admin-api"}')}`
          )
          return (await result.json()).data.result.length
        },
        { timeout: 30_000 }
      )
      .toBeGreaterThan(0)
    await expect
      .poll(
        async () => {
          const query = new URLSearchParams({
            "query.service_name": "enterprise-admin-api",
            "query.start_time_min": new Date(Date.now() - 60_000).toISOString(),
            "query.start_time_max": new Date(Date.now() + 60_000).toISOString(),
          })
          const result = await fetch(
            `http://127.0.0.1:${env.RELEASE_TRACING_PORT}/api/v3/traces?${query}`
          )
          return result.ok && (await result.text()).includes(requestId)
        },
        { timeout: 30_000 }
      )
      .toBe(true)
  } finally {
    await environment?.close()
    await shutdownTelemetry()
    for (const key of [
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "OTEL_METRIC_EXPORT_INTERVAL",
      "OTEL_BSP_SCHEDULE_DELAY",
    ]) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
    await writeFile(
      join(directory, "compose.log"),
      compose("logs", "--no-color")
    )
    compose("down", "--volumes")
    await rm(file, { force: true })
  }
})
