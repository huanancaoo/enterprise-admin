import { sql } from "drizzle-orm"
import type { TenantTx } from "../tenant.ts"

export const announcementRepository = {
  async inbox(
    tx: TenantTx,
    operation: string,
    id: string | null,
    input: Record<string, unknown>
  ): Promise<unknown> {
    const result = await tx.execute<{ result: unknown }>(sql`
      SELECT public.platform_announcement_inbox(
        ${tx.context.userId}::uuid,NULL::uuid,${tx.context.organizationId}::uuid,
        ${operation},${id}::uuid,${JSON.stringify(input)}::jsonb,${tx.context.requestId}
      ) AS result
    `)
    return result.rows[0].result
  },
}
