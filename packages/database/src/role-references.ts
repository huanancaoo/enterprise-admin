import type { QueryExecutor } from "./organization-status.ts"

export async function readRoleReferences(db: QueryExecutor, roleIds: string[]) {
  // 权限、引用数量和授权版本必须属于同一快照，不能把旧权限配上新版本交给确认窗口。
  const result = await db.query<{
    id: string
    permission: Record<string, string[]>
    memberCount: number
    invitationCount: number
    authorizationVersion: number
  }>(
    `SELECT r.id, r.permission::jsonb AS permission,
       (SELECT count(*)::int FROM member m WHERE m.organization_id = r.organization_id AND m.role = r.role) AS "memberCount",
       (SELECT count(*)::int FROM invitation i WHERE i.organization_id = r.organization_id AND i.role = r.role
         AND i.status = 'pending' AND i.expires_at > clock_timestamp()) AS "invitationCount",
       s.authorization_version AS "authorizationVersion"
     FROM organization_role r JOIN organization_status s ON s.organization_id = r.organization_id
     WHERE r.id = ANY($1::uuid[])`,
    [roleIds]
  )
  return result.rows
}
