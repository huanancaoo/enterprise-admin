import { and, eq, sql } from "drizzle-orm"
import { organization } from "../schema/auth.ts"
import type { TenantTx } from "../tenant.ts"

export const organizationSettingsRepository = {
  find(tx: TenantTx, organizationId: string) {
    return tx
      .select({
        organizationId: organization.id,
        defaultLocale: organization.defaultLocale,
        version: organization.defaultLocaleVersion,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
  },

  async update(
    tx: TenantTx,
    input: {
      organizationId: string
      expectedVersion: number
      defaultLocale: string | null
    }
  ) {
    await tx.execute(sql`
      SELECT set_config('app.auth_actor_id', ${tx.context.userId}, true),
             set_config('app.auth_request_id', ${tx.context.requestId}, true)
    `)
    return tx
      .update(organization)
      .set({
        defaultLocale: input.defaultLocale as "zh-CN" | "en-US" | "ar" | null,
        defaultLocaleVersion: sql`${organization.defaultLocaleVersion} + 1`,
      })
      .where(
        and(
          eq(organization.id, input.organizationId),
          eq(organization.defaultLocaleVersion, input.expectedVersion)
        )
      )
      .returning({
        organizationId: organization.id,
        defaultLocale: organization.defaultLocale,
        version: organization.defaultLocaleVersion,
      })
  },
}
