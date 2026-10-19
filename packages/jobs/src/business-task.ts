import {
  BusinessTaskResultSchema,
  type BusinessTask,
  type BusinessTaskResult,
} from "@workspace/contracts/framework-capabilities"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import {
  defineTask,
  TaskPermanentError,
  type TaskDefinition,
} from "./contract.ts"

// 导入的失败报告已经是持久结果；导出只有成功产物可以作为重放回执。
// 按正式任务类型穷尽声明，新增任务时必须明确它的结果语义。
const failedResultIsCommitted = {
  "projects.import": true,
  "projects.export": false,
  "members.export": false,
  "audit.export": false,
  "invitations.import": true,
} satisfies Record<BusinessTask["type"], boolean>

type BusinessTaskDefinition<I> = Omit<
  TaskDefinition<I, BusinessTaskResult>,
  "type" | "authorizeResource" | "findCommitted"
> & { type: BusinessTask["type"] }

export function defineBusinessTask<I>(definition: BusinessTaskDefinition<I>) {
  return defineTask({
    ...definition,
    async authorizeResource(tx, task) {
      // runtime 先验证当前成员与动作，再进入此处；任务行锁延续到回执读取和执行结束。
      const row = await businessTaskRepository.lock(
        tx,
        task.identity.resourceId
      )
      if (
        !row ||
        row.actorId !== task.identity.actorId ||
        row.type !== definition.type ||
        row.intentFingerprint !== task.intentFingerprint ||
        row.status === "rejected" ||
        (row.status === "failed" && !row.result)
      )
        throw new TaskPermanentError("RESOURCE_DENIED")
    },
    async findCommitted(tx, task) {
      const row = await businessTaskRepository.find(
        tx,
        task.identity.resourceId
      )
      return row &&
        (row.status === "completed" ||
          (row.status === "failed" &&
            failedResultIsCommitted[definition.type])) &&
        row.result
        ? {
            intentFingerprint: row.intentFingerprint,
            result: BusinessTaskResultSchema.parse(row.result),
          }
        : undefined
    },
  })
}
