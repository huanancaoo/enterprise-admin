import {
  CreateProjectExportSchema,
  CreateProjectImportSchema,
} from "@workspace/contracts/framework-capabilities"
import type { RegisteredTask } from "./contract.ts"
import { defineBusinessTask } from "./business-task.ts"

export const projectExchangeTasks: readonly RegisteredTask[] = [
  defineBusinessTask({
    type: "projects.import",
    inputSchema: CreateProjectImportSchema,
    permissions: { project: ["create"] },
    async execute(tx, task) {
      // HTTP 提交与任务执行共用授权定义；文件编解码仅在 Worker 实际执行时加载。
      const { executeProjectImport } =
        await import("./project-exchange-execution.ts")
      return executeProjectImport(tx, task)
    },
  }),
  defineBusinessTask({
    type: "projects.export",
    inputSchema: CreateProjectExportSchema,
    permissions: { project: ["export"] },
    async execute(tx, task) {
      const { executeProjectExport } =
        await import("./project-exchange-execution.ts")
      return executeProjectExport(tx, task)
    },
  }),
]
