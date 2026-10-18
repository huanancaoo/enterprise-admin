import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm"
import { member, user } from "../schema/auth.ts"
import type { TenantTx } from "../tenant.ts"

type MemberExportFilter = {
  q?: string
  role?: string
  sortBy: "createdAt" | "role"
  sortOrder: "asc" | "desc"
}
function memberExportWhere(tx: TenantTx, filter: MemberExportFilter) {
  const pattern = `%${(filter.q ?? "").replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
  return and(
    eq(member.organizationId, tx.context.organizationId),
    filter.role ? eq(member.role, filter.role) : undefined,
    or(ilike(user.name, pattern), ilike(user.email, pattern))
  )
}

export const organizationExchangeRepository = {
  async options(
    tx: TenantTx,
    query: { q?: string; userId?: string; page: number; pageSize: number }
  ) {
    const pattern = `%${(query.q ?? "").replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
    const result = await tx.execute<{
      total: number
      items: { userId: string; name: string }[]
    }>(sql`
      WITH filtered AS MATERIALIZED (
        SELECT m.user_id AS "userId", u.name FROM public.member m
        JOIN public."user" u ON u.id=m.user_id
        WHERE m.organization_id=${tx.context.organizationId}::uuid
          AND (${query.userId ?? null}::uuid IS NULL OR m.user_id=${query.userId ?? null}::uuid)
          AND u.name ILIKE ${pattern} ESCAPE '\\'
      ), page AS (
        SELECT * FROM filtered ORDER BY name, "userId" LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
      ) SELECT (SELECT count(*)::int FROM filtered) AS total,
        COALESCE((SELECT json_agg(page) FROM page),'[]'::json) AS items
    `)
    return { ...result.rows[0]!, page: query.page, pageSize: query.pageSize }
  },
  async countMembers(
    tx: TenantTx,
    filter: MemberExportFilter
  ): Promise<number> {
    const [result] = await tx
      .select({ total: count() })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(memberExportWhere(tx, filter))
    return result!.total
  },
  async members(
    tx: TenantTx,
    filter: MemberExportFilter,
    page: number,
    pageSize: number
  ) {
    const direction = filter.sortOrder === "asc" ? asc : desc
    return tx
      .select({
        userId: member.userId,
        name: user.name,
        email: user.email,
        role: member.role,
        createdAt: member.createdAt,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(memberExportWhere(tx, filter))
      .orderBy(
        direction(filter.sortBy === "role" ? member.role : member.createdAt),
        asc(member.id)
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize)
  },
}
