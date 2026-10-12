import { z } from "zod"

export const SupportedLocaleSchema = z
  .enum(["zh-CN", "en-US", "ar"])
  .meta({ id: "SupportedLocale" })
export const ProjectStatusSchema = z
  .enum(["draft", "active", "archived"])
  .meta({ id: "ProjectStatus" })
export const ProjectListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: ProjectStatusSchema.optional(),
  name: z.string().trim().optional(),
  sortBy: z.enum(["createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
})
