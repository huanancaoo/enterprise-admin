import { and, eq, sql } from "drizzle-orm"
import {
  domainEvents,
  webhookDeliveries,
  webhookEndpoints,
} from "../schema/business-capabilities.ts"
import type { TenantTx } from "../tenant.ts"

export const domainEventRepository = {
  async record(
    tx: TenantTx,
    input: {
      type: "project.created" | "project.updated" | "project.deleted"
      resourceId: string
      payload: Record<string, unknown>
    }
  ) {
    const [event] = await tx
      .insert(domainEvents)
      .values({
        ...input,
        organizationId: tx.context.organizationId,
        actorId: tx.context.userId,
      })
      .returning({ id: domainEvents.id })
    const eventId = event!.id
    const endpoints = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.organizationId, tx.context.organizationId),
          eq(webhookEndpoints.enabled, true),
          sql`${webhookEndpoints.events} @> ${JSON.stringify([input.type])}::jsonb`
        )
      )
    if (endpoints.length)
      await tx
        .insert(webhookDeliveries)
        .values(
          endpoints.map((endpoint) => ({
            organizationId: tx.context.organizationId,
            webhookId: endpoint.id,
            eventId,
          }))
        )
        .onConflictDoNothing({
          target: [webhookDeliveries.webhookId, webhookDeliveries.eventId],
        })
    return eventId
  },
}
