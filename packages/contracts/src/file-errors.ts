import { z } from "zod"

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
    operationId: z.uuid().optional(),
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
