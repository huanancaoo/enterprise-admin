import { and, count, desc, eq } from "drizzle-orm"
import {
  domainEvents,
  webhookDeliveries,
  webhookEndpoints,
} from "../schema/business-capabilities.ts"
import type { TenantTx } from "../tenant.ts"

type WebhookInput = Pick<
  typeof webhookEndpoints.$inferInsert,
  "name" | "url" | "events"
>
const metadata = {
  id: webhookEndpoints.id,
  organizationId: webhookEndpoints.organizationId,
  name: webhookEndpoints.name,
  url: webhookEndpoints.url,
  events: webhookEndpoints.events,
  enabled: webhookEndpoints.enabled,
  createdAt: webhookEndpoints.createdAt,
}
function endpointScope(tx: TenantTx, id?: string) {
  return and(
    eq(webhookEndpoints.organizationId, tx.context.organizationId),
    id ? eq(webhookEndpoints.id, id) : undefined
  )
}
export const webhookRepository = {
  async outbound(
    tx: TenantTx,
    claim: {
      id: string
      webhookId: string
      eventId: string
      leaseToken: string
    }
  ) {
    const [item] = await tx
      .select({
        url: webhookEndpoints.url,
        signingSecret: webhookEndpoints.signingSecret,
        eventId: domainEvents.id,
        type: domainEvents.type,
        resourceId: domainEvents.resourceId,
        occurredAt: domainEvents.createdAt,
        payload: domainEvents.payload,
      })
      .from(webhookDeliveries)
      .innerJoin(
        webhookEndpoints,
        and(
          eq(webhookEndpoints.id, webhookDeliveries.webhookId),
          eq(webhookEndpoints.organizationId, tx.context.organizationId)
        )
      )
      .innerJoin(
        domainEvents,
        and(
          eq(domainEvents.id, webhookDeliveries.eventId),
          eq(domainEvents.organizationId, tx.context.organizationId)
        )
      )
      .where(
        and(
          eq(webhookDeliveries.id, claim.id),
          eq(webhookDeliveries.organizationId, tx.context.organizationId),
          eq(webhookDeliveries.webhookId, claim.webhookId),
          eq(webhookDeliveries.eventId, claim.eventId),
          eq(webhookDeliveries.leaseToken, claim.leaseToken),
          eq(webhookDeliveries.status, "pending"),
          eq(webhookEndpoints.enabled, true),
          eq(webhookEndpoints.actorId, tx.context.userId)
        )
      )
      .limit(1)
    if (!item) return undefined
    return {
      url: item.url,
      signingSecret: item.signingSecret,
      body: {
        id: item.eventId,
        type: item.type,
        organizationId: tx.context.organizationId,
        resourceId: item.resourceId,
        occurredAt: item.occurredAt.toISOString(),
        data: item.payload,
      },
    }
  },
  async create(tx: TenantTx, input: WebhookInput, signingSecret: string) {
    const [item] = await tx
      .insert(webhookEndpoints)
      .values({
        ...input,
        signingSecret,
        organizationId: tx.context.organizationId,
        actorId: tx.context.userId,
      })
      .returning(metadata)
    return item!
  },
  async update(
    tx: TenantTx,
    id: string,
    input: WebhookInput & { enabled: boolean }
  ) {
    const [item] = await tx
      .update(webhookEndpoints)
      .set(input)
      .where(endpointScope(tx, id))
      .returning(metadata)
    return item
  },
  async delete(tx: TenantTx, id: string) {
    const [item] = await tx
      .delete(webhookEndpoints)
      .where(endpointScope(tx, id))
      .returning({ id: webhookEndpoints.id })
    return item
  },
  async deliveries(
    tx: TenantTx,
    id: string,
    query: { page: number; pageSize: number }
  ) {
    const [endpoint] = await tx
      .select({ id: webhookEndpoints.id })
      .from(webhookEndpoints)
      .where(endpointScope(tx, id))
      .limit(1)
    if (!endpoint) return undefined
    const visible = and(
      eq(webhookDeliveries.organizationId, tx.context.organizationId),
      eq(webhookDeliveries.webhookId, id)
    )
    const items = await tx
      .select({
        id: webhookDeliveries.id,
        webhookId: webhookDeliveries.webhookId,
        eventId: webhookDeliveries.eventId,
        eventType: domainEvents.type,
        status: webhookDeliveries.status,
        attempts: webhookDeliveries.attempts,
        lastStatusCode: webhookDeliveries.lastStatusCode,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        createdAt: webhookDeliveries.createdAt,
        deliveredAt: webhookDeliveries.deliveredAt,
      })
      .from(webhookDeliveries)
      .innerJoin(
        domainEvents,
        and(
          eq(domainEvents.id, webhookDeliveries.eventId),
          eq(domainEvents.organizationId, tx.context.organizationId)
        )
      )
      .where(visible)
      .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
    const [total] = await tx
      .select({ value: count() })
      .from(webhookDeliveries)
      .where(visible)
    return { items, total: total!.value, ...query }
  },
  list(tx: TenantTx) {
    return tx
      .select(metadata)
      .from(webhookEndpoints)
      .where(endpointScope(tx))
      .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id))
  },
}
