import { builtInOrganizationRolePermissions } from "@workspace/permissions"
import type { TenantTx } from "./tenant.ts"
import { sql } from "drizzle-orm"

function searchPattern(value = "") {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`
}
const roleSort = {
  "role:asc": "r.role ASC, r.id ASC",
  "role:desc": "r.role DESC, r.id ASC",
  "createdAt:asc": 'r."createdAt" ASC, r.id ASC',
  "createdAt:desc": 'r."createdAt" DESC, r.id ASC',
} as const
const invitationSort = {
  "createdAt:asc": 'i."createdAt" ASC, i.id ASC',
  "createdAt:desc": 'i."createdAt" DESC, i.id ASC',
  "expiresAt:asc": 'i."expiresAt" ASC, i.id ASC',
  "expiresAt:desc": 'i."expiresAt" DESC, i.id ASC',
} as const
export async function listOrganizationRoleDirectory(
  tx: TenantTx,
  query: {
    page: number
    pageSize: number
    q?: string
    kind?: "built-in" | "custom"
    sortBy: "role" | "createdAt"
    sortOrder: "asc" | "desc"
  }
) {
  // 内置角色直接投影代码中的权限事实；自定义角色及引用仍读取原生认证表。
  const result = await tx.execute<{
    total: number
    items: Record<string, unknown>[]
  }>(sql`WITH roles AS (
       SELECT 'builtin:' || b.key AS id, o.id AS "organizationId", b.key AS role,
         b.value AS permission, true AS "builtIn", o.created_at AT TIME ZONE 'UTC' AS "createdAt"
       FROM organization o CROSS JOIN jsonb_each(${JSON.stringify(builtInOrganizationRolePermissions)}::jsonb) b WHERE o.id = ${tx.context.organizationId}::uuid
       UNION ALL
       SELECT id::text, organization_id, role, permission::jsonb, false, created_at AT TIME ZONE 'UTC'
       FROM organization_role WHERE organization_id = ${tx.context.organizationId}::uuid
     ), filtered AS MATERIALIZED (
       SELECT r.*, s.authorization_version AS "authorizationVersion",
         (SELECT count(*)::int FROM member m WHERE m.organization_id = ${tx.context.organizationId}::uuid AND m.role = r.role) AS "memberCount",
         (SELECT count(*)::int FROM invitation i WHERE i.organization_id = ${tx.context.organizationId}::uuid AND i.role = r.role AND i.status = 'pending' AND i.expires_at > clock_timestamp()) AS "invitationCount"
       FROM roles r JOIN organization_status s ON s.organization_id = r."organizationId"
       WHERE r.role ILIKE ${searchPattern(query.q)} ESCAPE '\\' AND (${query.kind ?? null}::text IS NULL OR r."builtIn" = (${query.kind ?? null} = 'built-in'))
     ), page AS (
       SELECT * FROM filtered r ORDER BY ${sql.raw(roleSort[`${query.sortBy}:${query.sortOrder}`])} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
     )
     SELECT (SELECT count(*)::int FROM filtered) AS total, coalesce((SELECT json_agg(page) FROM page), '[]'::json) AS items`)
  return {
    ...result.rows[0],
    page: query.page,
    pageSize: query.pageSize,
    items: result.rows[0].items.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt as string).toISOString(),
    })),
  }
}
export async function listOrganizationInvitationDirectory(
  tx: TenantTx,
  query: {
    page: number
    pageSize: number
    q?: string
    status?: string
    sortBy: "createdAt" | "expiresAt"
    sortOrder: "asc" | "desc"
  }
) {
  // 过期状态与最近一次投递属于同一查询快照，避免分页总数和可操作状态互相矛盾。
  const result = await tx.execute<{
    total: number
    items: Record<string, unknown>[]
  }>(sql`WITH directory AS (
       SELECT i.id, i.email, i.role, i.status,
         CASE WHEN i.status = 'pending' AND i.expires_at <= clock_timestamp() THEN 'expired' ELSE i.status END AS "businessStatus",
         u.name AS "inviterName", i.created_at AT TIME ZONE 'UTC' AS "createdAt", i.expires_at AT TIME ZONE 'UTC' AS "expiresAt",
         CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('attemptId', a.id, 'status', a.status, 'attemptedAt', a.created_at, 'errorCode', a.error_code) END AS delivery
       FROM invitation i JOIN public."user" u ON u.id = i.inviter_id
       LEFT JOIN LATERAL (SELECT * FROM invitation_delivery_attempts WHERE invitation_id = i.id ORDER BY created_at DESC, id DESC LIMIT 1) a ON true
       WHERE i.organization_id = ${tx.context.organizationId}::uuid
     ), filtered AS MATERIALIZED (
       SELECT * FROM directory WHERE email ILIKE ${searchPattern(query.q)} ESCAPE '\\' AND (${query.status ?? null}::text IS NULL OR "businessStatus" = ${query.status ?? null})
     ), page AS (
       SELECT * FROM filtered i ORDER BY ${sql.raw(invitationSort[`${query.sortBy}:${query.sortOrder}`])} LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
     )
     SELECT (SELECT count(*)::int FROM filtered) AS total, coalesce((SELECT json_agg(page) FROM page), '[]'::json) AS items`)
  return {
    ...result.rows[0],
    page: query.page,
    pageSize: query.pageSize,
    items: result.rows[0].items.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt as string).toISOString(),
      expiresAt: new Date(row.expiresAt as string).toISOString(),
      delivery: row.delivery
        ? {
            ...(row.delivery as Record<string, unknown>),
            attemptedAt: new Date(
              (row.delivery as { attemptedAt: string }).attemptedAt
            ).toISOString(),
          }
        : null,
    })),
  }
}
