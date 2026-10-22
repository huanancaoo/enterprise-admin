import { z } from "zod"
import {
  FileResponseSchema,
  FileUsageResponseSchema,
  FolderResponseSchema,
} from "./files.js"

// 平台归属由平台入口确定；返回虚构 organizationId 会混淆租户与平台授权。
export const PlatformFolderSchema = FolderResponseSchema.omit({
  organizationId: true,
}).meta({ id: "PlatformFolder" })
export const PlatformFileSchema = FileResponseSchema.omit({
  organizationId: true,
}).meta({ id: "PlatformFile" })
export const PlatformFileEntrySchema = z
  .discriminatedUnion("kind", [PlatformFolderSchema, PlatformFileSchema])
  .meta({ id: "PlatformFileEntry" })
export type PlatformFileEntry = z.infer<typeof PlatformFileEntrySchema>
export const PlatformFileWorkspaceSchema = z
  .strictObject({ root: PlatformFolderSchema, usage: FileUsageResponseSchema })
  .meta({ id: "PlatformFileWorkspace" })
export type PlatformFileWorkspace = z.infer<typeof PlatformFileWorkspaceSchema>
export const PlatformFilePageSchema = z
  .strictObject({
    items: z.array(PlatformFileEntrySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .meta({ id: "PlatformFilePage" })
export const PlatformFileBreadcrumbsSchema = z
  .strictObject({ items: z.array(PlatformFolderSchema) })
  .meta({ id: "PlatformFileBreadcrumbs" })

export const UpdatePlatformFilePolicySchema = z
  .strictObject({
    expectedRevision: z.number().int().min(1).max(2147483647),
    quotaBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    trashDays: z.number().int().min(1).max(2147483647),
    historyDays: z.number().int().min(1).max(2147483647),
  })
  .meta({ id: "UpdatePlatformFilePolicy" })
export type UpdatePlatformFilePolicy = z.infer<
  typeof UpdatePlatformFilePolicySchema
>
export const PlatformFileReferencesSchema = z
  .strictObject({
    total: z.number().int().min(0),
    items: z.array(
      z.strictObject({
        fileId: z.uuid(),
        versionId: z.uuid(),
        announcementId: z.uuid(),
        title: z.string(),
      })
    ),
  })
  .meta({ id: "PlatformFileReferences" })
