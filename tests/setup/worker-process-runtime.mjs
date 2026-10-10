import { createDatabase } from "../../packages/database/dist/index.js"
import { createTaskTenantRunner } from "../../packages/database/dist/task-tenant.js"
import { startTaskWorker } from "../../packages/jobs/dist/index.js"
import { counterTask } from "./worker-task-fixture.mjs"

const { pool } = createDatabase(process.env.DATABASE_URL)
const config = JSON.parse(process.env.WORKER_TEST_CONFIG)
const gates = new Map()
process.on("message", (message) => {
  if (message.kind === "release") {
    gates.get(message.jobId)?.()
    gates.delete(message.jobId)
  }
})
const hold = (jobId, phase) =>
  new Promise((resolve) => {
    gates.set(jobId, resolve)
    process.send({ kind: "gate", jobId, phase })
  })
const runInTenant = createTaskTenantRunner(pool)
const runtime = await startTaskWorker({
  config,
  registry: [
    counterTask({
      transientErrorMessage: process.env.WORKER_TEST_FAILURE_HINT,
      beforeCommit:
        process.env.WORKER_TEST_GATE === "before_commit"
          ? (task) => hold(task.jobId, "before_commit")
          : undefined,
    }),
  ],
  async runInTenant(identity, permissions, work) {
    const result = await runInTenant(identity, permissions, work)
    // 只暂缓已提交事务的真实返回，以观察提交后、BullMQ 确认前的进程死亡。
    if (process.env.WORKER_TEST_GATE === "after_commit") {
      process.send({ kind: "committed", resourceId: identity.resourceId })
      await new Promise((resolve) => {
        gates.set("after_commit", resolve)
      })
    }
    return result
  },
  log: (event) => process.send({ kind: "log", event }),
})
process.send({ kind: "ready", pid: process.pid })
let closing = false
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (closing) return
    closing = true
    process.send({ kind: "closing" })
    try {
      await runtime.close()
      await pool.end()
      process.disconnect()
    } catch {
      // 关闭期限已经耗尽；退出释放连接，让真实重启重新领取未完成的任务。
      process.exit(1)
    }
  })
