import { and, eq, sql, type SQL } from "drizzle-orm"
import type { TenantTx } from "../tenant.ts"
import { organization } from "../schema/auth.ts"
import { projects, projectTranslations } from "../schema/projects.ts"

type Locale = typeof projectTranslations.$inferInsert.locale

export type ProjectListInput = {
  page: number
  pageSize: number
  status?: "draft" | "active" | "archived"
  name?: string
  sortBy: "createdAt" | "updatedAt"
  sortOrder: "asc" | "desc"
}
type LocalizedProject = typeof projects.$inferSelect & {
  resolvedLocale: Locale
  name: string
  description: string | null
}
type SerializedLocalizedProject = Omit<
  LocalizedProject,
  "createdAt" | "updatedAt"
> & {
  createdAt: string
  updatedAt: string
  missingBase: boolean
}

function localizedProjects(tx: TenantTx, predicate: SQL = sql``) {
  return sql`
    SELECT p.id, p.organization_id AS "organizationId", p.status,
      p.content_locale AS "contentLocale", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
      CASE WHEN wanted.project_id IS NOT NULL THEN wanted.locale ELSE base.locale END AS "resolvedLocale",
      CASE WHEN wanted.project_id IS NOT NULL THEN wanted.name ELSE base.name END AS name,
      CASE WHEN wanted.project_id IS NOT NULL THEN wanted.description ELSE base.description END AS description,
      base.project_id IS NULL AS "missingBase"
    FROM projects p
    LEFT JOIN project_translations base ON base.organization_id = ${tx.context.organizationId}
      AND base.project_id = p.id AND base.locale = p.content_locale
    LEFT JOIN project_translations wanted ON wanted.organization_id = ${tx.context.organizationId}
      AND wanted.project_id = p.id AND wanted.locale = ${tx.context.locale}
    WHERE p.organization_id = ${tx.context.organizationId} ${predicate}
  `
}

function toLocalizedProject(row: SerializedLocalizedProject): LocalizedProject {
  return {
    id: row.id,
    organizationId: row.organizationId,
    status: row.status,
    contentLocale: row.contentLocale,
    resolvedLocale: row.resolvedLocale,
    name: row.name,
    description: row.description,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  }
}

export const projectRepository = {
  async defaultLocale(tx: TenantTx) {
    const [row] = await tx
      .select({ locale: organization.defaultLocale })
      .from(organization)
      .where(eq(organization.id, tx.context.organizationId))
    if (!row) throw new Error("Authorized organization is missing")
    return row.locale
  },
  async listPage(tx: TenantTx, input: ProjectListInput) {
    const name = input.name?.trim()
    const pattern = name ? `%${name.replace(/[\\%_]/g, "\\$&")}%` : undefined
    const orderColumn =
      input.sortBy === "updatedAt" ? sql`"updatedAt"` : sql`"createdAt"`
    const orderDirection = input.sortOrder === "asc" ? sql`ASC` : sql`DESC`
    // 译文按整条记录选择，不能用 COALESCE(description) 混入基础语言描述。
    // 同一 SQL 同时取得 total 和当前页，越界页仍保留 total。
    const result = await tx.execute<
      SerializedLocalizedProject & { total: number; missing: number }
    >(sql`
      WITH localized AS (
        ${localizedProjects(
          tx,
          input.status ? sql`AND p.status = ${input.status}` : sql``
        )}
      ), filtered AS (
        SELECT * FROM localized ${pattern ? sql`WHERE name ILIKE ${pattern}` : sql``}
      )
      SELECT totals.total, integrity.missing, page.*
      FROM (SELECT count(*)::int AS total FROM filtered) totals
      CROSS JOIN (SELECT count(*)::int AS missing FROM localized WHERE "missingBase") integrity
      LEFT JOIN (
        SELECT * FROM filtered ORDER BY ${orderColumn} ${orderDirection}, id ASC
        LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
      ) page ON true
      ORDER BY page.${orderColumn} ${orderDirection}, page.id ASC
    `)
    const first = result.rows[0]!
    // 基础译文是数据不变量；缺失时不能悄悄丢弃项目或显示空名称。
    if (first.missing > 0)
      throw new Error("Project base translation is missing")
    const items: LocalizedProject[] = result.rows
      .filter((row) => row.id !== null)
      .map(toLocalizedProject)
    return {
      items,
      total: first.total,
      page: input.page,
      pageSize: input.pageSize,
    }
  },
  async findLocalized(tx: TenantTx, projectId: string) {
    const result = await tx.execute<SerializedLocalizedProject>(
      localizedProjects(tx, sql`AND p.id = ${projectId}`)
    )
    const row = result.rows[0]
    if (!row) return undefined
    // 详情与列表遵守同一个完整性不变量，不能用缺失内容伪装成 404。
    if (row.missingBase) throw new Error("Project base translation is missing")
    return toLocalizedProject(row)
  },
  async findForUpdate(tx: TenantTx, projectId: string) {
    const [project] = await tx
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, tx.context.organizationId),
          eq(projects.id, projectId)
        )
      )
      .for("update")
    return project
  },
  list(tx: TenantTx) {
    return tx
      .select()
      .from(projects)
      .where(eq(projects.organizationId, tx.context.organizationId))
  },
  translations(tx: TenantTx, projectId: string) {
    return tx
      .select()
      .from(projectTranslations)
      .where(
        and(
          eq(projectTranslations.organizationId, tx.context.organizationId),
          eq(projectTranslations.projectId, projectId)
        )
      )
  },
  async create(
    tx: TenantTx,
    input: { contentLocale: Locale; name: string; description: string | null }
  ) {
    const [project] = await tx
      .insert(projects)
      .values({
        organizationId: tx.context.organizationId,
        contentLocale: input.contentLocale,
      })
      .returning()
    await tx.insert(projectTranslations).values({
      organizationId: tx.context.organizationId,
      projectId: project!.id,
      locale: input.contentLocale,
      name: input.name.trim(),
      description: input.description,
    })
    return project!
  },
  delete(tx: TenantTx, projectId: string) {
    return tx
      .delete(projects)
      .where(
        and(
          eq(projects.organizationId, tx.context.organizationId),
          eq(projects.id, projectId)
        )
      )
      .returning()
  },
}
