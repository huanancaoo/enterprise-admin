import { z } from "zod"
import {
  FilePathError,
  normalizeFileName,
  normalizeFolderName,
} from "./file-path.js"

// 业务内容固定文件版本；改名和移动不会改写身份，覆盖也不会静默更新引用。
export const FileVersionReferenceSchema = z
  .strictObject({
    fileId: z.uuid(),
    versionId: z.uuid(),
  })
  .meta({ id: "FileVersionReference" })

export type FileVersionReference = z.infer<typeof FileVersionReferenceSchema>

export const maxOrganizationUploadBytes = 100 * 1024 ** 2
export const maxPersonalAvatarBytes = 5 * 1024 ** 2

function nameSchema(normalize: (value: string) => string) {
  return z.string().transform((value, context) => {
    try {
      return normalize(value)
    } catch (error) {
      if (!(error instanceof FilePathError)) throw error
      context.addIssue({ code: "custom", message: error.code })
      return z.NEVER
    }
  })
}

export const FileNameSchema = nameSchema(normalizeFileName)
export const FolderNameSchema = nameSchema(normalizeFolderName)
export const FileEntryIdSchema = z.uuid()
export const FileVersionIdSchema = z.uuid()
export const FileOperationIdSchema = z.uuid()

export const fileErrorCodes = [
  "FILE_NAME_CONFLICT",
  "FILE_NAME_INVALID",
  "FILE_NAME_TOO_LONG",
  "FILE_PATH_TOO_LONG",
  "FILE_FOLDER_CYCLE",
  "FILE_ROOT_PROTECTED",
  "FILE_REFERENCED",
  "FILE_RESTORE_EXPIRED",
  "FILE_QUOTA_EXCEEDED",
  "FILE_TOO_LARGE",
  "FILE_CONTENT_MISMATCH",
  "FILE_RANGE_INVALID",
  "FILE_OPERATION_IN_PROGRESS",
  "FILE_STORAGE_UNAVAILABLE",
] as const
export const FileErrorCodeSchema = z.enum(fileErrorCodes)
export type FileErrorCode = z.infer<typeof FileErrorCodeSchema>

// 错误信息只投影可处理的业务事实，不返回内部路径、操作计划或存储异常。
export const FileErrorDetailsSchema = z
  .strictObject({
    operationId: FileOperationIdSchema.optional(),
    revision: z.number().int().min(1).optional(),
    maximumBytes: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    referenceCount: z.number().int().min(0).optional(),
    quotaBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    usedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    reservedBytes: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .meta({ id: "FileErrorDetails" })
export type FileErrorDetails = z.infer<typeof FileErrorDetailsSchema>

export const FileEntryStateSchema = z.enum(["active", "trashed"])
export const FilePreviewKindSchema = z.enum([
  "image",
  "pdf",
  "text",
  "audio",
  "video",
  "none",
])
export const FileVersionResponseSchema = z
  .strictObject({
    id: FileVersionIdSchema,
    fileId: FileEntryIdSchema,
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    contentType: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    previewKind: FilePreviewKindSchema,
    isCurrent: z.boolean(),
    createdAt: z.iso.datetime(),
    retiredAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "FileVersionResponse" })
export type FileVersionResponse = z.infer<typeof FileVersionResponseSchema>

const entryFields = {
  id: FileEntryIdSchema,
  organizationId: z.uuid(),
  parentId: FileEntryIdSchema.nullable(),
  name: z.string(),
  // 这是界面中的相对层级；物理根目录、bucket 和内部定位不属于 HTTP 契约。
  path: z.array(z.string()),
  revision: z.number().int().min(1),
  state: FileEntryStateSchema,
  operationId: FileOperationIdSchema.nullable(),
  deletedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}
export const FolderResponseSchema = z
  .strictObject({ kind: z.literal("folder"), ...entryFields })
  .meta({ id: "FolderResponse" })
export type FolderResponse = z.infer<typeof FolderResponseSchema>
export const FileResponseSchema = z
  .strictObject({
    kind: z.literal("file"),
    ...entryFields,
    currentVersion: FileVersionResponseSchema,
  })
  .meta({ id: "FileResponse" })
export type FileResponse = z.infer<typeof FileResponseSchema>
export const FileEntryResponseSchema = z
  .discriminatedUnion("kind", [FolderResponseSchema, FileResponseSchema])
  .meta({ id: "FileEntryResponse" })
export type FileEntryResponse = z.infer<typeof FileEntryResponseSchema>

export const FileListQuerySchema = z.strictObject({
  parentId: FileEntryIdSchema.optional(),
  state: FileEntryStateSchema.default("active"),
  name: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["name", "size", "updatedAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
})
export type FileListQuery = z.infer<typeof FileListQuerySchema>
export const FilePageSchema = z
  .strictObject({
    items: z.array(FileEntryResponseSchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
  })
  .meta({ id: "FilePage" })
export type FilePage = z.infer<typeof FilePageSchema>
export const FileBreadcrumbsSchema = z
  .strictObject({ items: z.array(FolderResponseSchema) })
  .meta({ id: "FileBreadcrumbs" })
export type FileBreadcrumbs = z.infer<typeof FileBreadcrumbsSchema>
export const FileUsageResponseSchema = z
  .strictObject({
    quotaBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    usedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    reservedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    transientBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    trashDays: z.number().int().min(1),
    historyDays: z.number().int().min(1),
    policyRevision: z.number().int().min(1),
    maxUploadBytes: z.literal(maxOrganizationUploadBytes),
  })
  .meta({ id: "FileUsageResponse" })
export type FileUsageResponse = z.infer<typeof FileUsageResponseSchema>
export const FileWorkspaceSchema = z
  .strictObject({ root: FolderResponseSchema, usage: FileUsageResponseSchema })
  .meta({ id: "FileWorkspace" })
export type FileWorkspace = z.infer<typeof FileWorkspaceSchema>

export const CreateFolderSchema = z
  .strictObject({
    operationId: FileOperationIdSchema,
    parentId: FileEntryIdSchema,
    name: FolderNameSchema,
  })
  .meta({ id: "CreateFolder" })
export type CreateFolder = z.infer<typeof CreateFolderSchema>

// multipart 的文件字段由 OpenAPI 声明为二进制；这些字段仍由同一 Schema 校验。
export const UploadFileFieldsSchema = z
  .strictObject({
    operationId: FileOperationIdSchema,
    parentId: FileEntryIdSchema,
    name: FileNameSchema,
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    declaredBytes: z.coerce
      .number()
      .int()
      .min(0)
      .max(maxOrganizationUploadBytes),
  })
  .meta({ id: "UploadFileFields" })
export type UploadFileFields = z.infer<typeof UploadFileFieldsSchema>
export const OverwriteFileFieldsSchema = z
  .strictObject({
    operationId: FileOperationIdSchema,
    expectedRevision: z.coerce.number().int().min(1),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
    declaredBytes: z.coerce
      .number()
      .int()
      .min(0)
      .max(maxOrganizationUploadBytes),
  })
  .meta({ id: "OverwriteFileFields" })
export type OverwriteFileFields = z.infer<typeof OverwriteFileFieldsSchema>

export const UploadFileBodySchema = UploadFileFieldsSchema.extend({
  file: z.file().max(maxOrganizationUploadBytes).meta({ format: "binary" }),
})
export const OverwriteFileBodySchema = OverwriteFileFieldsSchema.extend({
  file: z.file().max(maxOrganizationUploadBytes).meta({ format: "binary" }),
})

export const FileEntryImpactQuerySchema = z.strictObject({
  action: z.enum(["trash", "purge"]),
})
export type FileEntryImpactQuery = z.infer<typeof FileEntryImpactQuerySchema>

const operationFields = {
  operationId: FileOperationIdSchema,
  expectedRevision: z.number().int().min(1),
}
export const RenameFileEntrySchema = z
  .strictObject({ ...operationFields, name: FileNameSchema })
  .meta({ id: "RenameFileEntry" })
export type RenameFileEntry = z.infer<typeof RenameFileEntrySchema>
export const MoveFileEntrySchema = z
  .strictObject({ ...operationFields, parentId: FileEntryIdSchema })
  .meta({ id: "MoveFileEntry" })
export type MoveFileEntry = z.infer<typeof MoveFileEntrySchema>
export const TrashFileEntrySchema = z
  .strictObject(operationFields)
  .meta({ id: "TrashFileEntry" })
export type TrashFileEntry = z.infer<typeof TrashFileEntrySchema>
export const RestoreFileEntrySchema = z
  .strictObject({
    ...operationFields,
    parentId: FileEntryIdSchema.optional(),
    name: FileNameSchema.optional(),
  })
  .meta({ id: "RestoreFileEntry" })
export type RestoreFileEntry = z.infer<typeof RestoreFileEntrySchema>
export const PurgeFileEntrySchema = z
  .strictObject(operationFields)
  .meta({ id: "PurgeFileEntry" })
export type PurgeFileEntry = z.infer<typeof PurgeFileEntrySchema>

export const FileOperationActionSchema = z.enum([
  "upload",
  "overwrite",
  "create-folder",
  "rename",
  "move",
  "trash",
  "restore",
  "purge",
])
export const FileOperationPhaseSchema = z.enum([
  "pending",
  "preparing",
  "committed",
  "cleaning",
  "completed",
  "failed",
])
export const FileOperationErrorCodeSchema = z.enum([
  ...fileErrorCodes,
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "ORGANIZATION_SUSPENDED",
  "AUTHORIZATION_UNAVAILABLE",
  "AUDIT_UNAVAILABLE",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_KEY_REUSED",
  "INTERNAL_ERROR",
])
export const FileOperationResponseSchema = z
  .strictObject({
    id: FileOperationIdSchema,
    action: FileOperationActionSchema,
    phase: FileOperationPhaseSchema,
    committedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    errorCode: FileOperationErrorCodeSchema.nullable(),
    result: z
      .strictObject({
        entryId: FileEntryIdSchema,
        revision: z.number().int().min(1),
        versionId: FileVersionIdSchema.optional(),
        affectedEntries: z.number().int().min(1).optional(),
      })
      .nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .superRefine((operation, context) => {
    const committed = ["committed", "cleaning", "completed"].includes(
      operation.phase
    )
    if (
      committed !== (operation.committedAt !== null) ||
      committed !== (operation.result !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Operation phase must agree with its publication facts",
      })
    }
    if (
      (operation.phase === "completed") !==
      (operation.completedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only completed operations have a completion timestamp",
      })
    }
  })
  .meta({ id: "FileOperationResponse" })
export type FileOperationResponse = z.infer<typeof FileOperationResponseSchema>

export const FileEntryImpactSchema = z
  .strictObject({
    entryId: FileEntryIdSchema,
    revision: z.number().int().min(1),
    fileCount: z.number().int().min(0),
    folderCount: z.number().int().min(0),
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    referenceCount: z.number().int().min(0),
  })
  .meta({ id: "FileEntryImpact" })
export type FileEntryImpact = z.infer<typeof FileEntryImpactSchema>

export const FileVersionsSchema = z
  .strictObject({ items: z.array(FileVersionResponseSchema) })
  .meta({ id: "FileVersions" })
export type FileVersions = z.infer<typeof FileVersionsSchema>

export const FileContentQuerySchema = z.strictObject({
  disposition: z.enum(["inline", "attachment"]).default("attachment"),
})
export type FileContentQuery = z.infer<typeof FileContentQuerySchema>
