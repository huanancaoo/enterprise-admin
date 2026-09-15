import { and, eq } from "drizzle-orm"
import type { TenantTx } from "../tenant.ts"
import { projects, projectTranslations } from "../schema/projects.ts"

type Locale = typeof projectTranslations.$inferInsert.locale

export const projectRepository = {
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
