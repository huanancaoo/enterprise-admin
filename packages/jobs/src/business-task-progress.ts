import { BusinessTaskErrorCodeSchema } from "@workspace/contracts"
import { recordBusinessTaskAttempt } from "@workspace/database/business-task-control"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import {
  createTenantRunner,
  type TenantContext,
} from "@workspace/database/tenant"
import type { TaskSubmission } from "./runtime.ts"

type BusinessTaskBinding = Parameters<typeof recordBusinessTaskAttempt>[1]

export type BusinessTaskObservation =
  | { kind: "submission"; context: TenantContext; outcome: TaskSubmission }
  | { kind: "recovery"; outcome: TaskSubmission }
  | { kind: "permanent-rejection"; code: string }
  | { kind: "worker-active" }
  | { kind: "worker-failed"; unrecoverable: boolean; failedReason: string }

function failureCode(value: unknown) {
  const parsed = BusinessTaskErrorCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : "EXECUTION_FAILED"
}

export async function recordBusinessTaskProgress(
  pool: Parameters<typeof createTenantRunner>[0],
  binding: BusinessTaskBinding,
  observation: BusinessTaskObservation
): Promise<void> {
  const record = (
    status: Parameters<typeof recordBusinessTaskAttempt>[2],
    code: string | null = null
  ) => recordBusinessTaskAttempt(pool, binding, status, code)

  switch (observation.kind) {
    case "submission": {
      const { outcome, context } = observation
      if (
        outcome.status === "enqueued" ||
        outcome.status === "already_exists"
      ) {
        // 请求只确认入队；这里仍须在组织写事务中重新检查组织状态。
        // 补读执行结果属于恢复观察，不能用系统结算函数绕过当前请求的写入约束。
        await createTenantRunner(pool)(
          context,
          (tx) => businessTaskRepository.markQueued(tx, binding.resourceId),
          "write"
        )
      }
      return
    }
    case "recovery": {
      const { outcome } = observation
      if (outcome.status === "enqueued") return record("queued")
      if (outcome.status !== "already_exists") return
      if (outcome.state === "active") return record("running")
      if (outcome.state !== "failed") return record("queued")
      const code = failureCode(outcome.failureCode)
      // 恢复时只剩持久失败码；实时 Worker 则保有原始错误类型，两者的事实不可互换。
      return record(
        [
          "PERMISSION_DENIED",
          "MEMBERSHIP_REQUIRED",
          "ORGANIZATION_SUSPENDED",
          "RESOURCE_DENIED",
          "TOO_MANY_ROWS",
        ].includes(code)
          ? "rejected"
          : "failed",
        code
      )
    }
    case "permanent-rejection":
      return record("rejected", failureCode(observation.code))
    case "worker-active":
      return record("running")
    case "worker-failed":
      return record(
        observation.unrecoverable ? "rejected" : "failed",
        failureCode(observation.failedReason)
      )
  }
}
