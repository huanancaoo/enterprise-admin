import { z } from "zod"
import {
  BusinessTaskResultSchema,
  CreateOrganizationInvitationImportSchema,
  InvitationImportReportSchema,
  InvitationImportRowCodeSchema,
  type InvitationImportReport,
  type InvitationImportRow,
} from "@workspace/contracts"
import { businessTaskRepository } from "@workspace/database/repositories/business-tasks"
import {
  createOrganizationInvitation,
  invitationFailureCode,
  invitationTenantExecutor,
  nativeInvitationCreator,
} from "@workspace/database/invitation-command"
import type { TenantTx } from "@workspace/database/tenant"
import { defineTask, TaskPermanentError, type TaskContext } from "./contract.ts"
import { parseInvitationImportWorkbook } from "./invitation-import-workbook.ts"

export const InvitationImportTaskInputSchema =
  CreateOrganizationInvitationImportSchema.extend({
    sourceIpHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
async function authorizeResource(tx: TenantTx, task: TaskContext) {
  const row = await businessTaskRepository.lock(tx, task.identity.resourceId)
  if (
    !row ||
    row.actorId !== task.identity.actorId ||
    row.type !== "invitations.import" ||
    row.intentFingerprint !== task.intentFingerprint ||
    row.status === "rejected" ||
    (row.status === "failed" && !row.result)
  )
    throw new TaskPermanentError("RESOURCE_DENIED")
}
async function committed(tx: TenantTx, task: TaskContext) {
  const row = await businessTaskRepository.find(tx, task.identity.resourceId)
  return row && ["completed", "failed"].includes(row.status) && row.result
    ? {
        intentFingerprint: row.intentFingerprint,
        result: BusinessTaskResultSchema.parse(row.result),
      }
    : undefined
}
export function createOrganizationInvitationImportTask(policy: {
  organization: number
  actor: number
  ip: number
}) {
  return defineTask({
    type: "invitations.import",
    inputSchema: InvitationImportTaskInputSchema,
    permissions: { invitation: ["create"] },
    authorizeResource,
    findCommitted: committed,
    async execute(tx, task) {
      const source = await parseInvitationImportWorkbook(
        Buffer.from(task.input.contentBase64, "base64")
      )
      const rows: InvitationImportRow[] = []
      const db = invitationTenantExecutor(tx)
      // 复用现有任务事务与身份→组织锁；撤权不能穿过正在提交的这次有界执行。
      await db.query(
        "SELECT set_config('app.expected_authorization_version',authorization_version::text,true) FROM organization_status WHERE organization_id=$1",
        [task.identity.organizationId]
      )
      for (const sourceRow of source.rows) {
        if (sourceRow.plannedCode) {
          rows.push({
            row: sourceRow.row,
            email: sourceRow.email,
            status:
              sourceRow.plannedCode === "DUPLICATE_IN_FILE"
                ? "skipped"
                : "failed",
            code: sourceRow.plannedCode,
            invitationId: null,
          })
          continue
        }
        await db.query("SAVEPOINT invitation_import_row")
        try {
          const { invitation } = await createOrganizationInvitation(
            db,
            nativeInvitationCreator(tx),
            {
              organizationId: task.identity.organizationId,
              actorId: task.identity.actorId,
              requestId: task.identity.requestId,
              email: sourceRow.email,
              role: task.input.role,
              ipHash: task.input.sourceIpHash,
              limits: policy,
            }
          )
          rows.push({
            row: sourceRow.row,
            email: sourceRow.email,
            status: "invited",
            code: "INVITED",
            invitationId: invitation.id,
          })
          await db.query("RELEASE SAVEPOINT invitation_import_row")
        } catch (error) {
          await db.query("ROLLBACK TO SAVEPOINT invitation_import_row")
          await db.query("RELEASE SAVEPOINT invitation_import_row")
          const code = invitationFailureCode(error)
          // 只有已知业务拒绝成为逐行结果；数据库中断等系统故障整批回滚，由队列重试。
          if (!code) throw error
          const value = InvitationImportRowCodeSchema.parse(code)
          rows.push({
            row: sourceRow.row,
            email: sourceRow.email,
            status:
              value === "MEMBER_ALREADY_EXISTS" ||
              value === "INVITATION_ALREADY_PENDING"
                ? "skipped"
                : "failed",
            code: value,
            invitationId: null,
          })
        }
      }
      const report: InvitationImportReport = InvitationImportReportSchema.parse(
        {
          invited: rows.filter((row) => row.status === "invited").length,
          skipped: rows.filter((row) => row.status === "skipped").length,
          failed: rows.filter((row) => row.status === "failed").length,
          rows,
          ...(source.fileError ? { fileError: source.fileError } : {}),
        }
      )
      const { invited, skipped, failed } = report
      const result = {
        count: invited,
        issues: [],
        invitationImport: { invited, skipped, failed },
      }
      // 原生邀请、投递意图、成功留痕与报告原子提交；提交后重试直接读取已结算结果。
      await businessTaskRepository.finish(
        tx,
        task.identity.resourceId,
        result,
        Buffer.from(JSON.stringify(report)).toString("base64"),
        source.fileError ? "failed" : "completed"
      )
      return result
    },
  })
}
