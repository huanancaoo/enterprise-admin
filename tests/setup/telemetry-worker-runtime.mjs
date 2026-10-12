import { createRequire } from "node:module"
import { resolve } from "node:path"
import { createDatabase } from "../../packages/database/dist/index.js"
import { createTaskTenantRunner } from "../../packages/database/dist/task-tenant.js"
import { startTaskWorker } from "../../packages/jobs/dist/index.js"
import {
  initializeTelemetry,
  shutdownTelemetry,
} from "../../packages/observability/dist/index.js"
import { counterTask } from "./worker-task-fixture.mjs"

const { sql } = createRequire(resolve("packages/database/package.json"))(
  "drizzle-orm"
)
const { trace, SpanStatusCode } = createRequire(
  resolve("packages/observability/package.json")
)("@opentelemetry/api")
initializeTelemetry("worker")
const { pool } = createDatabase(process.env.DATABASE_URL)
const marker = process.env.TELEMETRY_SQL_SECRET
const definition = counterTask()
const runtime = await startTaskWorker({
  config: JSON.parse(process.env.WORKER_TEST_CONFIG),
  registry: [
    {
      ...definition,
      async execute(tx) {
        const span = trace.getActiveSpan()
        // 测试组合通过真实处理器的诊断入口覆盖自由文本/结果载荷，再制造带绑定参数的真实 SQL 失败。
        process.send({ kind: "execute", activeSpan: !!span })
        span.setStatus({ code: SpanStatusCode.ERROR, message: marker })
        span.setAttribute("bullmq.job.result", marker)
        span.setAttribute("job.data", marker)
        try {
          await tx.execute(sql`SELECT ${marker}::uuid`)
        } catch (error) {
          process.send({ kind: "sqlFailed", code: error.cause?.code })
          span.recordException(error)
          throw error
        }
      },
    },
  ],
  runInTenant: createTaskTenantRunner(pool),
})
process.send({ kind: "ready" })
process.once("SIGTERM", async () => {
  await runtime.close()
  await pool.end()
  await shutdownTelemetry()
  process.disconnect()
})
