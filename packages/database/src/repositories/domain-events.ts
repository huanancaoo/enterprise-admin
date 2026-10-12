import { and, eq, inArray, sql } from "drizzle-orm"
import {
  businessTasks,
  domainEvents,
  webhookDeliveries,
  webhookEndpoints,
} from "../schema/business-capabilities.ts"
import type { TenantTx } from "../tenant.ts"

export const domainEventRepository = {
  async record(
    tx: TenantTx,
    input: {
      type: string
      resourceId: string
      payload: Record<string, unknown>
    }
  ) {
    let eventId: string | undefined
    if (["task.completed", "task.failed"].includes(input.type)) {
      const [task] = await tx
        .select({ id: businessTasks.id, status: businessTasks.status })
        .from(businessTasks)
        .where(
          and(
            eq(businessTasks.id, input.resourceId),
            eq(businessTasks.organizationId, tx.context.organizationId),
            eq(businessTasks.actorId, tx.context.userId)
          )
        )
        .for("update")
      if (
        !task ||
        !["completed", "failed", "rejected"].includes(task.status) ||
        input.type !==
          (task.status === "completed" ? "task.completed" : "task.failed")
      )
        throw new Error("TASK_RESULT_NOT_TERMINAL")
      // 与系统结算入口共用真实 task 行锁，重复发布复用同一终态事件身份。
      const [existing] = await tx
        .select({ id: domainEvents.id })
        .from(domainEvents)
        .where(
          and(
            eq(domainEvents.organizationId, tx.context.organizationId),
            eq(domainEvents.resourceId, input.resourceId),
            inArray(domainEvents.type, ["task.completed", "task.failed"])
          )
        )
        .limit(1)
      eventId = existing?.id
    }
    if (!eventId) {
      const [event] = await tx
        .insert(domainEvents)
        .values({
          ...input,
          organizationId: tx.context.organizationId,
          actorId: tx.context.userId,
        })
        .returning({ id: domainEvents.id })
      eventId = event!.id
    }
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
