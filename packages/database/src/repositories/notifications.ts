import { user } from "../schema/auth.ts"
import { and, count, desc, eq, isNull, sql } from "drizzle-orm"
import {
  businessTasks,
  businessNotifications,
  notificationPreferences,
} from "../schema/business-capabilities.ts"
import type { TenantTx } from "../tenant.ts"

export const notificationRepository = {
  async outbound(
    tx: TenantTx,
    claim: { id: string; taskId: string; leaseToken: string }
  ) {
    const preference = await this.preferences(tx)
    if (!preference.emailEnabled) return undefined
    const [item] = await tx
      .select({ email: user.email, type: businessNotifications.type })
      .from(businessNotifications)
      .innerJoin(user, eq(user.id, businessNotifications.recipientId))
      .where(
        and(
          eq(businessNotifications.id, claim.id),
          eq(businessNotifications.organizationId, tx.context.organizationId),
          eq(businessNotifications.recipientId, tx.context.userId),
          eq(businessNotifications.taskId, claim.taskId),
          eq(businessNotifications.emailLeaseToken, claim.leaseToken),
          eq(businessNotifications.emailStatus, "pending")
        )
      )
      .limit(1)
    return item
  },
  async recordTaskResult(
    tx: TenantTx,
    input: Pick<
      typeof businessTasks.$inferSelect,
      "id" | "type" | "status" | "result" | "errorCode"
    >
  ) {
    const [task] = await tx
      .select({
        id: businessTasks.id,
        type: businessTasks.type,
        status: businessTasks.status,
      })
      .from(businessTasks)
      .where(
        and(
          eq(businessTasks.id, input.id),
          eq(businessTasks.organizationId, tx.context.organizationId),
          eq(businessTasks.actorId, tx.context.userId)
        )
      )
      .limit(1)
    if (
      !task ||
      task.type !== input.type ||
      task.status !== input.status ||
      !["completed", "failed", "rejected"].includes(task.status)
    )
      throw new Error("TASK_RESULT_NOT_TERMINAL")
    await tx
      .insert(businessNotifications)
      .values({
        organizationId: tx.context.organizationId,
        recipientId: tx.context.userId,
        taskId: task.id,
        taskType: task.type,
        type: task.status === "completed" ? "task.completed" : "task.failed",
      })
      .onConflictDoNothing({
        target: [
          businessNotifications.taskId,
          businessNotifications.recipientId,
        ],
      })
  },
  async listPage(tx: TenantTx, input: { page: number; pageSize: number }) {
    const visible = and(
      eq(businessNotifications.organizationId, tx.context.organizationId),
      eq(businessNotifications.recipientId, tx.context.userId)
    )
    const items = await tx
      .select({
        id: businessNotifications.id,
        organizationId: businessNotifications.organizationId,
        recipientId: businessNotifications.recipientId,
        type: businessNotifications.type,
        taskId: businessNotifications.taskId,
        taskType: businessNotifications.taskType,
        createdAt: businessNotifications.createdAt,
        readAt: businessNotifications.readAt,
      })
      .from(businessNotifications)
      .where(visible)
      .orderBy(
        desc(businessNotifications.createdAt),
        desc(businessNotifications.id)
      )
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize)
    const [total] = await tx
      .select({ value: count() })
      .from(businessNotifications)
      .where(visible)
    const [unread] = await tx
      .select({ value: count() })
      .from(businessNotifications)
      .where(and(visible, isNull(businessNotifications.readAt)))
    return { items, total: total!.value, unreadCount: unread!.value, ...input }
  },
  async read(tx: TenantTx, id: string) {
    const [item] = await tx
      .update(businessNotifications)
      .set({ readAt: sql`coalesce(${businessNotifications.readAt}, now())` })
      .where(
        and(
          eq(businessNotifications.id, id),
          eq(businessNotifications.organizationId, tx.context.organizationId),
          eq(businessNotifications.recipientId, tx.context.userId)
        )
      )
      .returning({
        id: businessNotifications.id,
        organizationId: businessNotifications.organizationId,
        recipientId: businessNotifications.recipientId,
        type: businessNotifications.type,
        taskId: businessNotifications.taskId,
        taskType: businessNotifications.taskType,
        createdAt: businessNotifications.createdAt,
        readAt: businessNotifications.readAt,
      })
    return item
  },
  async preferences(tx: TenantTx) {
    const [value] = await tx
      .select({ emailEnabled: notificationPreferences.emailEnabled })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.organizationId, tx.context.organizationId),
          eq(notificationPreferences.userId, tx.context.userId)
        )
      )
      .limit(1)
    // 尚未设置时采用业务表定义的默认选择，站内通知不依赖邮件开关。
    return value ?? { emailEnabled: false }
  },
  async updatePreferences(tx: TenantTx, emailEnabled: boolean) {
    const [value] = await tx
      .insert(notificationPreferences)
      .values({
        organizationId: tx.context.organizationId,
        userId: tx.context.userId,
        emailEnabled,
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.organizationId,
          notificationPreferences.userId,
        ],
        set: { emailEnabled },
      })
      .returning({ emailEnabled: notificationPreferences.emailEnabled })
    return value!
  },
}
