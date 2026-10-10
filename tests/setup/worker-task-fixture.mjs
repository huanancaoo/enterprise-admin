import { createRequire } from "node:module"
import { resolve } from "node:path"
import {
  defineTask,
  TaskPermanentError,
} from "../../packages/jobs/dist/index.js"

const require = createRequire(resolve("packages/contracts/package.json"))
const { z } = require("zod")
const { sql } = createRequire(resolve("packages/database/package.json"))(
  "drizzle-orm"
)

// 这是测试组合入口的领域处理器；生产 Worker 不注册任何演示业务。
export function counterTask({
  beforeCommit,
  transientErrorMessage = "fixture transient failure",
} = {}) {
  return defineTask({
    type: "test.increment",
    inputSchema: z.strictObject({
      amount: z.number().int().min(1).max(10),
      failAttempts: z.number().int().min(0).max(3).default(0),
    }),
    permissions: { project: ["update"] },
    async authorizeResource(tx, task) {
      const result = await tx.execute(sql`
        SELECT id FROM worker_test_resources
        WHERE organization_id=${task.identity.organizationId}::uuid
          AND id=${task.identity.resourceId}::uuid
      `)
      if (result.rows.length !== 1)
        throw new TaskPermanentError("RESOURCE_DENIED")
    },
    async findCommitted(tx, task) {
      // 业务意图锁覆盖检查与提交；BullMQ 重新领取后仍可能与旧执行者重叠。
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${task.jobId},0))`
      )
      const result = await tx.execute(sql`
        SELECT intent_fingerprint AS "intentFingerprint", result
        FROM worker_test_receipts
        WHERE organization_id=${task.identity.organizationId}::uuid
          AND actor_id=${task.identity.actorId}::uuid
          AND task_type='test.increment' AND idempotency_key=${task.idempotencyKey}
      `)
      return result.rows[0]
    },
    async execute(tx, task) {
      if (task.attempt <= task.input.failAttempts)
        throw new Error(transientErrorMessage)
      const changed = await tx.execute(sql`
        UPDATE worker_test_resources SET value=value+${task.input.amount}
        WHERE organization_id=${task.identity.organizationId}::uuid
          AND id=${task.identity.resourceId}::uuid RETURNING value
      `)
      const result = {
        value: changed.rows[0].value,
        locale: task.identity.locale,
      }
      await tx.execute(sql`
        INSERT INTO worker_test_receipts
          (organization_id,actor_id,task_type,idempotency_key,intent_fingerprint,result)
        VALUES (${task.identity.organizationId}::uuid,${task.identity.actorId}::uuid,
          'test.increment',${task.idempotencyKey},${task.intentFingerprint},${JSON.stringify(result)}::jsonb)
      `)
      await tx.execute(sql`
        INSERT INTO audit_events (organization_id,event_code,actor_id,resource_type,resource_id,request_id,operation_id,fields)
        VALUES (${task.identity.organizationId}::uuid,'worker.fixture_committed',${task.identity.actorId}::uuid,
          'worker_test_resource',${task.identity.resourceId}::uuid,${task.identity.requestId},${task.jobId},
          ${JSON.stringify({ amount: task.input.amount })}::jsonb)
      `)
      await beforeCommit?.(task)
      return result
    },
  })
}
