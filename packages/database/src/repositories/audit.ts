import { auditEvents } from "../schema/audit.ts"
import type { TenantTx } from "../tenant.ts"

export const auditRepository = {
  record(
    tx: TenantTx,
    input: {
      eventCode: string
      resourceId: string
      fields: Record<string, unknown>
    }
  ) {
    return tx.insert(auditEvents).values({
      ...input,
      organizationId: tx.context.organizationId,
      actorId: tx.context.userId,
      requestId: tx.context.requestId,
    })
  },
}
