import { BusinessTaskErrorCodeSchema } from "@workspace/contracts"
import { createTaskTenantRunner } from "@workspace/database/task-tenant"
import {
  pendingBusinessTaskScopes,
  recordBusinessTaskAttempt,
} from "@workspace/database/business-task-control"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import { getTask, type TaskRequest } from "./contract.ts"
import { createTaskProducer, taskErrorCode } from "./runtime.ts"
import { projectExchangeTasks } from "./project-exchange.ts"
import type { WorkerConfig } from "./config.ts"

export function startBusinessTaskDispatch(
  pool: Parameters<typeof createTaskTenantRunner>[0],
  config: WorkerConfig
) {
  const runInTenant = createTaskTenantRunner(pool)
  const producer = createTaskProducer({
    config,
    registry: projectExchangeTasks,
    runInTenant,
  })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function dispatch() {
    let after: string | null = null
    while (!stopped) {
      const scopes = await pendingBusinessTaskScopes(pool, after)
      if (!scopes.length) break
      for (const scope of scopes) {
        if (stopped) break
        const identity = {
          organizationId: scope.organization_id,
          actorId: scope.actor_id,
          resourceId: scope.id,
          locale: scope.locale,
          requestId: scope.request_id,
        }
        try {
          // 系统枚举只提供身份；当前成员与动作检查后才能读取业务输入并派发。
          const request = await runInTenant(
            identity,
            getTask(projectExchangeTasks, scope.type).permissions,
            async (tx): Promise<TaskRequest | null> => {
              const row = await businessTaskRepository.find(tx, scope.id)
              return row &&
                ["submitted", "queued", "running"].includes(row.status)
                ? {
                    type: row.type,
                    identity,
                    idempotencyKey: row.idempotencyKey,
                    input: row.input,
                  }
                : null
            }
          )
          if (!request) continue
          const outcome = await producer.submit(request)
          const binding = {
            ...identity,
            intentFingerprint: scope.intent_fingerprint,
          }
          if (outcome.status === "enqueued")
            await recordBusinessTaskAttempt(pool, binding, "queued", null)
          if (outcome.status === "already_exists") {
            if (outcome.state === "active")
              await recordBusinessTaskAttempt(pool, binding, "running", null)
            else if (outcome.state === "failed") {
              const parsed = BusinessTaskErrorCodeSchema.safeParse(
                outcome.failureCode
              )
              const code = parsed.success ? parsed.data : "EXECUTION_FAILED"
              await recordBusinessTaskAttempt(
                pool,
                binding,
                [
                  "PERMISSION_DENIED",
                  "MEMBERSHIP_REQUIRED",
                  "ORGANIZATION_SUSPENDED",
                  "RESOURCE_DENIED",
                ].includes(code)
                  ? "rejected"
                  : "failed",
                code
              )
            } else
              await recordBusinessTaskAttempt(pool, binding, "queued", null)
          }
        } catch (error) {
          const rawCode = taskErrorCode(error)
          const parsed = BusinessTaskErrorCodeSchema.safeParse(rawCode)
          const code = parsed.success ? parsed.data : "EXECUTION_FAILED"
          if (rawCode)
            await recordBusinessTaskAttempt(
              pool,
              { ...identity, intentFingerprint: scope.intent_fingerprint },
              "rejected",
              code
            )
          else throw error
        }
      }
      after = scopes.at(-1)!.id
    }
  }
  async function tick() {
    try {
      await dispatch()
    } catch {
      console.error(
        JSON.stringify({
          event: "task_dispatch_failed",
          code: "TASK_DISPATCH_UNAVAILABLE",
        })
      )
    }
    if (!stopped)
      timer = setTimeout(() => {
        current = tick()
      }, 1000)
  }
  // 派发承接持久提交意图，Redis 的确认超时与进程重启不会丢掉已接受的业务任务。
  let current = tick()
  return async () => {
    stopped = true
    clearTimeout(timer)
    await current
    await producer.close()
  }
}
