import { z } from "zod"
import { AuditEventsQuerySchema } from "./audit.js"

export const MemberExportFilterSchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  role: z.string().trim().min(1).max(48).optional(),
  sortBy: z.enum(["createdAt", "role"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
export const CreateMemberExportSchema = z
  .strictObject({
    format: z.literal("xlsx"),
    filter: MemberExportFilterSchema,
  })
  .meta({ id: "CreateMemberExport" })
export type CreateMemberExport = z.infer<typeof CreateMemberExportSchema>

// 导出固定使用列表实际查询窗口；排除页码，含义是导出筛选全集。
export const CreateAuditExportSchema = z
  .strictObject({
    format: z.literal("xlsx"),
    filter: AuditEventsQuerySchema.omit({ page: true, pageSize: true }).extend({
      from: z.iso.datetime(),
      to: z.iso.datetime(),
    }),
  })
  .meta({ id: "CreateAuditExport" })
export type CreateAuditExport = z.infer<typeof CreateAuditExportSchema>

export const OrganizationMemberOptionsQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  userId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type OrganizationMemberOptionsQuery = z.infer<
  typeof OrganizationMemberOptionsQuerySchema
>
export const OrganizationMemberOptionSchema = z
  .strictObject({
    userId: z.uuid(),
    name: z.string(),
  })
  .meta({ id: "OrganizationMemberOption" })
export type OrganizationMemberOption = z.infer<
  typeof OrganizationMemberOptionSchema
>
export const OrganizationMemberOptionsPageSchema = z
  .strictObject({
    items: z.array(OrganizationMemberOptionSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .meta({ id: "OrganizationMemberOptionsPage" })
