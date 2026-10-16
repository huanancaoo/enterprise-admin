import { Pool } from "pg"
import { createTaskTenantRunner } from "@workspace/database/task-tenant"
import { readWorkerConfig, startTaskWorker } from "@workspace/jobs"
import { observeBusinessTasks } from "@workspace/jobs/business-task-observer"
import { startBusinessTaskDispatch } from "@workspace/jobs/business-task-dispatch"
import { taskRegistry } from "./registry.ts"
import {
  initializeTelemetry,
  shutdownTelemetry,
  operationalLogger,
} from "@workspace/observability"

async function main() {
  initializeTelemetry("enterprise-admin-worker")
  const config = readWorkerConfig(process.env)
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: config.producerTimeoutMs,
    max: config.concurrency,
    application_name: "enterprise-admin-worker",
  })
  pool.on("error", () =>
    operationalLogger.error({
      event: "database_error",
      code: "DATABASE_UNAVAILABLE",
    })
  )
  try {
    const result = await pool.query<{ role: string; privileged: boolean }>(
      "SELECT current_user AS role, (rolsuper OR rolbypassrls) AS privileged FROM pg_roles WHERE rolname = current_user"
    )
    if (result.rows[0]?.role !== "app_runtime" || result.rows[0].privileged)
      throw new Error("WORKER_RUNTIME_ROLE_REQUIRED")
    const runtime = await startTaskWorker({
      config,
      registry: taskRegistry,
      runInTenant: createTaskTenantRunner(pool),
    })
    const closeObserver = observeBusinessTasks(
      runtime.worker,
      pool,
      config.attempts
    )
    const closeDispatcher = startBusinessTaskDispatch(pool, config)
    let closing = false
    const stop = () => {
      if (closing) return
      closing = true
      // 关闭期限与部署 stop_grace_period 对齐；超时退出交给队列重新领取与持久业务幂等。
      const deadline = setTimeout(() => {
        operationalLogger.error({
          event: "worker_shutdown_failed",
          code: "WORKER_SHUTDOWN_TIMEOUT",
        })
        process.exit(1)
      }, config.shutdownMs)
      void closeDispatcher()
        .then(() => runtime.close())
        .then(() => closeObserver())
        .then(() => pool.end())
        .then(() => shutdownTelemetry())
        .then(() => {
          clearTimeout(deadline)
          process.exitCode = 0
        })
        .catch(() => {
          operationalLogger.error({
            event: "worker_shutdown_failed",
            code: "WORKER_CLOSE_FAILED",
          })
          process.exit(1)
        })
    }
    process.once("SIGTERM", stop)
    process.once("SIGINT", stop)
  } catch (error) {
    await pool.end()
    throw error
  }
}
void main().catch((error: unknown) => {
  const code =
    error instanceof Error &&
    ["DATABASE_URL_REQUIRED", "WORKER_RUNTIME_ROLE_REQUIRED"].includes(
      error.message
    )
      ? error.message
      : "WORKER_START_FAILED"
  operationalLogger.error({ event: "worker_start_failed", code })
  process.exitCode = 1
})
