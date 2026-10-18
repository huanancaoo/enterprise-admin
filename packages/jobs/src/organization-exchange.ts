import {
  BusinessTaskResultSchema,
  CreateAuditExportSchema,
  CreateMemberExportSchema,
  type CreateAuditExport,
  type CreateMemberExport,
} from "@workspace/contracts"
import { auditRepository } from "@workspace/database/repositories/audit"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import { organizationExchangeRepository } from "@workspace/database/repositories/organization-exchange"
import type { TenantTx } from "@workspace/database/tenant"
import { defineTask, TaskPermanentError, type TaskContext } from "./contract.ts"
import {
  assertOrganizationExportCapacity,
  ORGANIZATION_EXPORT_PAGE_SIZE,
  writeOrganizationExportArtifact,
} from "./organization-export-artifact.ts"

async function authorizeResource(
  tx: TenantTx,
  task: TaskContext,
  type: string
) {
  const row = await businessTaskRepository.lock(tx, task.identity.resourceId)
  if (
    !row ||
    row.actorId !== task.identity.actorId ||
    row.type !== type ||
    row.intentFingerprint !== task.intentFingerprint ||
    row.status === "rejected" ||
    (row.status === "failed" && !row.result)
  )
    throw new TaskPermanentError("RESOURCE_DENIED")
}

async function committed(tx: TenantTx, task: TaskContext) {
  const row = await businessTaskRepository.find(tx, task.identity.resourceId)
  return row?.status === "completed" && row.result
    ? {
        intentFingerprint: row.intentFingerprint,
        result: BusinessTaskResultSchema.parse(row.result),
      }
    : undefined
}

async function finish(
  tx: TenantTx,
  task: TaskContext,
  title: string,
  columns: string[],
  rows: AsyncIterable<readonly unknown[]>
) {
  const artifact = await writeOrganizationExportArtifact({
    title,
    columns,
    rows,
  })
  const result = { count: artifact.count, issues: [] }
  await businessTaskRepository.finish(
    tx,
    task.identity.resourceId,
    result,
    artifact.contentBase64,
    "completed"
  )
  return result
}

export const organizationExchangeTasks = [
  defineTask({
    type: "members.export",
    inputSchema: CreateMemberExportSchema,
    permissions: { member: ["export"] },
    authorizeResource: (tx, task) =>
      authorizeResource(tx, task, "members.export"),
    findCommitted: committed,
    async execute(tx, task: TaskContext<CreateMemberExport>) {
      assertOrganizationExportCapacity(
        await organizationExchangeRepository.countMembers(tx, task.input.filter)
      )
      async function* rows() {
        for (let page = 1; ; page++) {
          const batch = await organizationExchangeRepository.members(
            tx,
            task.input.filter,
            page,
            ORGANIZATION_EXPORT_PAGE_SIZE
          )
          for (const row of batch)
            yield [
              row.userId,
              row.name,
              row.email,
              row.role,
              row.createdAt.toISOString(),
            ]
          if (batch.length < ORGANIZATION_EXPORT_PAGE_SIZE) break
        }
      }
      return finish(
        tx,
        task,
        "Members",
        ["userId", "name", "email", "role", "createdAt"],
        rows()
      )
    },
  }),
  defineTask({
    type: "audit.export",
    inputSchema: CreateAuditExportSchema,
    permissions: { audit: ["export"] },
    authorizeResource: (tx, task) =>
      authorizeResource(tx, task, "audit.export"),
    findCommitted: committed,
    async execute(tx, task: TaskContext<CreateAuditExport>) {
      const first = await auditRepository.listPage(tx, {
        filter: task.input.filter,
        page: 1,
        pageSize: ORGANIZATION_EXPORT_PAGE_SIZE,
      })
      assertOrganizationExportCapacity(first.total)
      async function* rows() {
        let batch = first
        for (let page = 1; ; page++) {
          // 使用列表的可见范围及微秒窗口；平台身份和tenant非公开摘要均不扩大投影。
          for (const row of batch.items)
            yield [
              row.id,
              row.occurredAt,
              row.eventCode,
              row.scope,
              row.actorType,
              row.scope === "platform" ? null : row.actorId,
              row.scope === "platform" ? null : row.resourceType,
              row.scope === "platform" ? null : row.resourceId,
              row.result,
              row.scope === "platform" ? row.publicSummary : null,
            ]
          if (page * batch.pageSize >= batch.total) break
          batch = await auditRepository.listPage(tx, {
            filter: task.input.filter,
            page: page + 1,
            pageSize: ORGANIZATION_EXPORT_PAGE_SIZE,
          })
        }
      }
      return finish(
        tx,
        task,
        "Operation logs",
        [
          "id",
          "occurredAt",
          "eventCode",
          "scope",
          "actorType",
          "actorId",
          "resourceType",
          "resourceId",
          "result",
          "publicSummary",
        ],
        rows()
      )
    },
  }),
]
