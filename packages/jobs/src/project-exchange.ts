import {
  BusinessTaskResultSchema,
  CreateProjectExportSchema,
  CreateProjectImportSchema,
} from "@workspace/contracts/framework-capabilities"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import {
  defineTask,
  TaskPermanentError,
  type RegisteredTask,
} from "./contract.ts"

export const projectExchangeTasks: readonly RegisteredTask[] = [
  defineTask({
    type: "projects.import",
    inputSchema: CreateProjectImportSchema,
    permissions: { project: ["create"] },
    async authorizeResource(tx, task) {
      const row = await businessTaskRepository.lock(
        tx,
        task.identity.resourceId
      )
      if (
        !row ||
        row.actorId !== task.identity.actorId ||
        row.type !== "projects.import" ||
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
        (row.status === "completed" || row.status === "failed") &&
        row.result
        ? {
            intentFingerprint: row.intentFingerprint,
            result: BusinessTaskResultSchema.parse(row.result),
          }
        : undefined
    },
    async execute(tx, task) {
      // HTTP 提交与任务执行共用授权定义；文件编解码仅在 Worker 实际执行时加载。
      const { executeProjectImport } =
        await import("./project-exchange-execution.ts")
      return executeProjectImport(tx, task)
    },
  }),
  defineTask({
    type: "projects.export",
    inputSchema: CreateProjectExportSchema,
    permissions: { project: ["export"] },
    async authorizeResource(tx, task) {
      const row = await businessTaskRepository.lock(
        tx,
        task.identity.resourceId
      )
      if (
        !row ||
        row.actorId !== task.identity.actorId ||
        row.type !== "projects.export" ||
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
      return row?.status === "completed" && row.result
        ? {
            intentFingerprint: row.intentFingerprint,
            result: BusinessTaskResultSchema.parse(row.result),
          }
        : undefined
    },
    async execute(tx, task) {
      const { executeProjectExport } =
        await import("./project-exchange-execution.ts")
      return executeProjectExport(tx, task)
    },
  }),
]
