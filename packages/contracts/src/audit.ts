import { z } from "zod"

export const AuditResultSchema = z
  .enum(["succeeded", "denied", "failed", "no_change"])
  .meta({ id: "AuditResult" })
export type AuditResult = z.infer<typeof AuditResultSchema>
export const AuditScopeSchema = z
  .enum(["tenant", "platform"])
  .meta({ id: "AuditScope" })
export type AuditScope = z.infer<typeof AuditScopeSchema>
export const AuditEventIdSchema = z.uuid()
export const AuditEventsQuerySchema = z
  .strictObject({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    actorId: z.uuid().optional(),
    eventCode: z.string().trim().min(1).max(120).optional(),
    resourceType: z.string().trim().min(1).max(80).optional(),
    resourceId: z.uuid().optional(),
    result: AuditResultSchema.optional(),
    page: z.coerce.number().int().min(1).max(2147483647).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .meta({ id: "AuditEventsQuery" })
export type AuditEventsQuery = z.infer<typeof AuditEventsQuerySchema>
export const AuditEventSchema = z
  .strictObject({
    id: z.uuid(),
    occurredAt: z.iso.datetime(),
    eventCode: z.string().min(1),
    scope: AuditScopeSchema,
    actorType: z.enum(["user", "deployment_operator", "system"]),
    actorId: z.uuid().nullable(),
    resourceType: z.string().nullable(),
    resourceId: z.uuid().nullable(),
    result: AuditResultSchema,
    publicSummary: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "AuditEvent" })
export type AuditEvent = z.infer<typeof AuditEventSchema>
export const AuditEventsPageSchema = z
  .strictObject({
    items: z.array(AuditEventSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    window: z.strictObject({ from: z.iso.datetime(), to: z.iso.datetime() }),
  })
  .meta({ id: "AuditEventsPage" })
export type AuditEventsPage = z.infer<typeof AuditEventsPageSchema>
