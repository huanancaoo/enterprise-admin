import { z } from "zod"

const directoryPage = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
}
export const OrganizationRoleDirectoryQuerySchema = z.object({
  ...directoryPage,
  kind: z.enum(["built-in", "custom"]).optional(),
  sortBy: z.enum(["role", "createdAt"]).default("role"),
})
export const OrganizationRoleDirectoryItemSchema = z
  .object({
    id: z.string(),
    organizationId: z.uuid(),
    role: z.string(),
    permission: z.record(z.string(), z.array(z.string())),
    builtIn: z.boolean(),
    createdAt: z.iso.datetime(),
    memberCount: z.number().int().nonnegative(),
    invitationCount: z.number().int().nonnegative(),
    authorizationVersion: z.number().int().positive(),
  })
  .meta({ id: "OrganizationRoleDirectoryItem" })
export const OrganizationRoleDirectoryPageSchema = z
  .object({
    items: z.array(OrganizationRoleDirectoryItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .meta({ id: "OrganizationRoleDirectoryPage" })
export const InvitationBusinessStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "canceled",
  "expired",
])
export const OrganizationInvitationDirectoryQuerySchema = z.object({
  ...directoryPage,
  status: InvitationBusinessStatusSchema.optional(),
  sortBy: z.enum(["createdAt", "expiresAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export const OrganizationInvitationDirectoryItemSchema = z
  .object({
    id: z.uuid(),
    email: z.string(),
    role: z.string(),
    status: z.string(),
    businessStatus: InvitationBusinessStatusSchema,
    inviterName: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    delivery: z
      .object({
        attemptId: z.uuid(),
        status: z.enum(["pending", "smtp_accepted", "failed", "unknown"]),
        attemptedAt: z.iso.datetime(),
        errorCode: z.string().nullable(),
      })
      .nullable(),
  })
  .meta({ id: "OrganizationInvitationDirectoryItem" })
export const OrganizationInvitationDirectoryPageSchema = z
  .object({
    items: z.array(OrganizationInvitationDirectoryItemSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .meta({ id: "OrganizationInvitationDirectoryPage" })
export type OrganizationRoleDirectoryQuery = z.infer<
  typeof OrganizationRoleDirectoryQuerySchema
>
export type OrganizationRoleDirectoryItem = z.infer<
  typeof OrganizationRoleDirectoryItemSchema
>
export type OrganizationRoleDirectoryPage = z.infer<
  typeof OrganizationRoleDirectoryPageSchema
>
export type OrganizationInvitationDirectoryQuery = z.infer<
  typeof OrganizationInvitationDirectoryQuerySchema
>
export type OrganizationInvitationDirectoryItem = z.infer<
  typeof OrganizationInvitationDirectoryItemSchema
>
export type OrganizationInvitationDirectoryPage = z.infer<
  typeof OrganizationInvitationDirectoryPageSchema
>
