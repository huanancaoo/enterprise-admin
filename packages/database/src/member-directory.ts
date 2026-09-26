import { APIError } from "better-auth/api"
import type { QueryExecutor } from "./organization-status.ts"

export const memberSortFields = ["createdAt", "role"] as const
export type MemberSortField = (typeof memberSortFields)[number]
export const memberPageSizeDefault = 20
export const memberPageSizeMax = 100

const builtinMemberReadRoles = new Set(["owner", "admin", "member"])

export type MemberListQuery = {
  limit?: string | number
  offset?: string | number
  sortBy?: string
  sortDirection?: string
  filterField?: string
  filterValue?: string | number | boolean
  filterOperator?: string
  q?: string
  organizationId?: string | null
  organizationSlug?: string | null
}

export type NormalizedMemberListQuery = {
  limit: number
  offset: number
  sortBy: MemberSortField
  sortDirection: "asc" | "desc"
  role?: string
  q?: string
}

function invalidMemberQuery(): never {
  throw new APIError("BAD_REQUEST", {
    code: "INVALID_MEMBER_QUERY",
    message: "INVALID_MEMBER_QUERY",
  })
}

function integerQuery(value: string | number | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isInteger(parsed)) invalidMemberQuery()
  return parsed
}

export function normalizeMemberListQuery(
  query: MemberListQuery
): NormalizedMemberListQuery {
  const limit = integerQuery(query.limit, memberPageSizeDefault)
  const offset = integerQuery(query.offset, 0)
  if (limit < 1 || limit > memberPageSizeMax || offset < 0) invalidMemberQuery()

  const sortBy = query.sortBy ?? "createdAt"
  if (!memberSortFields.includes(sortBy as MemberSortField))
    invalidMemberQuery()
  const sortDirection = query.sortDirection ?? "desc"
  if (sortDirection !== "asc" && sortDirection !== "desc") invalidMemberQuery()

  if (
    query.filterField !== undefined &&
    query.filterField !== "" &&
    query.filterField !== "role"
  )
    invalidMemberQuery()
  if (
    query.filterOperator !== undefined &&
    query.filterOperator !== "" &&
    query.filterOperator !== "eq"
  )
    invalidMemberQuery()
  const role =
    query.filterField === "role" ? String(query.filterValue ?? "") : undefined
  if (role !== undefined && role.trim() === "") invalidMemberQuery()

  const q = query.q?.trim()
  return {
    limit,
    offset,
    sortBy: sortBy as MemberSortField,
    sortDirection,
    role,
    q: q ? q : undefined,
  }
}

function likePattern(value: string) {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
}

const orderBy = {
  "createdAt:asc": 'm."createdAt" ASC, m.id ASC',
  "createdAt:desc": 'm."createdAt" DESC, m.id ASC',
  "role:asc": "m.role ASC, m.id ASC",
  "role:desc": "m.role DESC, m.id ASC",
} as const

export async function assertMemberDirectoryRead(
  pool: QueryExecutor,
  organizationId: string,
  userId: string
) {
  const member = await pool.query<{ role: string }>(
    `SELECT role FROM member WHERE organization_id = $1 AND user_id = $2`,
    [organizationId, userId]
  )
  const role = member.rows[0]?.role
  if (!role || builtinMemberReadRoles.has(role)) return
  const custom = await pool.query<{ permission: string }>(
    `SELECT permission FROM organization_role
     WHERE organization_id = $1 AND role = $2`,
    [organizationId, role]
  )
  const permission = JSON.parse(custom.rows[0]?.permission ?? "{}") as {
    member?: unknown
  }
  if (
    !Array.isArray(permission.member) ||
    !permission.member.includes("read")
  ) {
    throw new APIError("FORBIDDEN", {
      code: "FORBIDDEN",
      message: "FORBIDDEN",
    })
  }
}

type MemberRow = {
  id: string
  organizationId: string
  userId: string
  role: string
  createdAt: string
  name: string
  email: string
  image: string | null
}

export async function searchOrganizationMembers(
  pool: QueryExecutor,
  organizationId: string,
  query: NormalizedMemberListQuery
) {
  // 总数与分页共用同一快照；空页也必须保留总数，才能从过期页码返回有效页。
  const result = await pool.query<{ total: number; members: MemberRow[] }>(
    `WITH filtered AS MATERIALIZED (
       SELECT m.id,
            m.organization_id AS "organizationId",
            m.user_id AS "userId",
            m.role,
            m.created_at AT TIME ZONE 'UTC' AS "createdAt",
            u.name,
            u.email,
            u.image
     FROM member m
     JOIN public."user" u ON u.id = m.user_id
     WHERE m.organization_id = $1
       AND ($2::text IS NULL OR m.role = $2)
       AND (u.name ILIKE $3 ESCAPE '\\' OR u.email ILIKE $3 ESCAPE '\\')
     ), page AS (
       SELECT * FROM filtered m
       ORDER BY ${orderBy[`${query.sortBy}:${query.sortDirection}`]}
       LIMIT $4 OFFSET $5
     )
     SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
            COALESCE((SELECT json_agg(page) FROM page), '[]'::json) AS members`,
    [
      organizationId,
      query.role ?? null,
      likePattern(query.q ?? ""),
      query.limit,
      query.offset,
    ]
  )
  const page = result.rows[0]
  return {
    members: page.members.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      role: row.role,
      createdAt: row.createdAt,
      user: {
        id: row.userId,
        name: row.name,
        email: row.email,
        image: row.image,
      },
    })),
    total: page.total,
  }
}
