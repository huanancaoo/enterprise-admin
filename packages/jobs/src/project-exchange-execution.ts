import ExcelJS from "exceljs"
import { stringify } from "csv-stringify/sync"
import type {
  BusinessTaskResult,
  CreateProjectExport,
  CreateProjectImport,
} from "@workspace/contracts"
import type { TenantTx } from "@workspace/database/tenant"
import { domainEventRepository } from "@workspace/database/repositories/domain-events"
import { auditRepository } from "@workspace/database/repositories/audit"
import { projectRepository } from "@workspace/database/repositories/projects"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import type { TaskContext } from "./contract.ts"
import { decodeProjectImport } from "./import-projects.ts"

export async function executeProjectImport(
  tx: TenantTx,
  task: TaskContext<CreateProjectImport>
): Promise<BusinessTaskResult> {
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
}

export async function executeProjectExport(
  tx: TenantTx,
  task: TaskContext<CreateProjectExport>
): Promise<BusinessTaskResult> {
  const projects = await projectRepository.exportMatching(tx, task.input.filter)
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
}
