import ExcelJS from "exceljs"
import { stringify } from "csv-stringify/sync"
import {
  BusinessTaskResultSchema,
  CreateProjectExportSchema,
  CreateProjectImportSchema,
  type BusinessTaskResult,
} from "@workspace/contracts"
import { domainEventRepository } from "@workspace/database/repositories/domain-events"
import { auditRepository } from "@workspace/database/repositories/audit"
import { decodeProjectImport } from "./import-projects.ts"
import { projectRepository } from "@workspace/database/repositories/projects"
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
      const decoded = await decodeProjectImport(task.input)
      // 先校验全部行，之后才执行项目写入；坏行不能留下合法行已经导入的部分事实。
      if (!decoded.issues.length)
        for (const row of decoded.rows) {
          const project = await projectRepository.create(tx, row)
          await domainEventRepository.record(tx, {
            type: "project.created",
            resourceId: project.id,
            payload: {
              status: project.status,
              contentLocale: project.contentLocale,
            },
          })
          await auditRepository.record(tx, {
            resourceType: "project",
            eventCode: "project.created",
            resourceId: project.id,
            fields: {
              status: project.status,
              contentLocale: project.contentLocale,
            },
          })
        }
      const result: BusinessTaskResult = {
        count: decoded.issues.length ? 0 : decoded.rows.length,
        issues: decoded.issues,
      }
      await businessTaskRepository.finish(
        tx,
        task.identity.resourceId,
        result,
        Buffer.from(JSON.stringify(result)).toString("base64"),
        decoded.issues.length ? "failed" : "completed"
      )
      return result
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
      const projects = await projectRepository.exportMatching(
        tx,
        task.input.filter
      )
      // contentLocale 描述导出文本实际使用的内容语言，保持重新导入时的文本归属。
      const rows = projects.map((project) => [
        project.name,
        project.description ?? "",
        project.resolvedLocale,
      ])
      let bytes: Buffer
      if (task.input.format === "csv") {
        bytes = Buffer.from(
          stringify([["name", "description", "contentLocale"], ...rows]),
          "utf8"
        )
      } else {
        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet("Projects")
        sheet.addRows([["name", "description", "contentLocale"], ...rows])
        bytes = Buffer.from(await workbook.xlsx.writeBuffer())
      }
      const result: BusinessTaskResult = { count: rows.length, issues: [] }
      await businessTaskRepository.finish(
        tx,
        task.identity.resourceId,
        result,
        bytes.toString("base64"),
        "completed"
      )
      return result
    },
  }),
]
