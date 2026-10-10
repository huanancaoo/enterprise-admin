import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-postgres"
import type { Pool, PoolClient } from "pg"
import {
  builtInOrganizationRoleKeys,
  builtInOrganizationRolePermissions,
  type PermissionRequest,
} from "@workspace/permissions"
import { role, type Statements } from "better-auth/plugins/access"
import type { TenantContext, TenantTx } from "./tenant.ts"
import { initializeTenantTransaction } from "./tenant-transaction.ts"

export type TaskIdentity = Readonly<{
  organizationId: string
  actorId: string
  resourceId: string
  locale: TenantContext["locale"]
  requestId: string
}>

export class TaskAuthorizationError extends Error {
  constructor(
    readonly code:
      "ORGANIZATION_SUSPENDED" | "MEMBERSHIP_REQUIRED" | "PERMISSION_DENIED"
  ) {
    super(code)
    this.name = "TaskAuthorizationError"
  }
}

export function createTaskTenantRunner(connection: Pool | PoolClient) {
  const db = drizzle(connection)
  return async function runTaskInTenant<T>(
    identity: TaskIdentity,
    permissions: PermissionRequest,
    work: (tx: TenantTx) => Promise<T>
  ): Promise<T> {
    const snapshot = Object.freeze({ ...identity })
    const required = structuredClone(permissions)
    return db.transaction(async (tx) => {
      try {
        await tx.execute(
          sql`SELECT public.require_active_organization(${snapshot.organizationId}::uuid)`
        )
      } catch (error) {
        const code =
          error instanceof Error &&
          "cause" in error &&
          error.cause instanceof Error &&
          "code" in error.cause
            ? error.cause.code
            : undefined
        // 无有效目标组织时与成员不存在同类拒绝，不向任务结果暴露组织存在性。
        if (code === "ORS01")
          throw new TaskAuthorizationError("MEMBERSHIP_REQUIRED")
        if (code === "ORS02")
          throw new TaskAuthorizationError("ORGANIZATION_SUSPENDED")
        throw error
      }
      // 与组织启停和成员角色变更共用锁；必须等锁后读取当前成员和动作。
      const result = await tx.execute<{
        membership_id: string
        role: string
        permission: string | null
      }>(
        sql`SELECT m.id AS membership_id, m.role, r.permission FROM public.member m
            JOIN public."user" u ON u.id = m.user_id
            LEFT JOIN public.organization_role r ON r.organization_id = m.organization_id AND r.role = m.role
            WHERE m.organization_id = ${snapshot.organizationId}::uuid
              AND m.user_id = ${snapshot.actorId}::uuid`
      )
      const member = result.rows[0]
      if (!member) throw new TaskAuthorizationError("MEMBERSHIP_REQUIRED")
      const builtIn = builtInOrganizationRoleKeys.find(
        (key) => key === member.role
      )
      const statements: Statements = builtIn
        ? builtInOrganizationRolePermissions[builtIn]
        : JSON.parse(member.permission ?? "{}")
      if (!role(statements).authorize(required).success)
        throw new TaskAuthorizationError("PERMISSION_DENIED")
      const context = Object.freeze({
        organizationId: snapshot.organizationId,
        userId: snapshot.actorId,
        membershipId: member.membership_id,
        locale: snapshot.locale,
        requestId: snapshot.requestId,
      })
      return work(await initializeTenantTransaction(tx, context))
    })
  }
}
