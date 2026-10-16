import { z } from "zod"
import { SupportedLocaleSchema } from "./locale.js"
import { FileErrorDetailsSchema, fileErrorCodes } from "./file-errors.js"

export const ApiErrorCodeSchema = z
  .enum([
    "VALIDATION_ERROR",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "PLATFORM_MFA_REQUIRED",
    "NOT_FOUND",
    "ORGANIZATION_SUSPENDED",
    "AUTHORIZATION_UNAVAILABLE",
    "AUDIT_UNAVAILABLE",
    "VERSION_CONFLICT",
    "IDEMPOTENCY_KEY_REUSED",
    "PERSONAL_MEDIA_OPERATION_EXPIRED",
    "PERSONAL_MEDIA_CONTENT_MISMATCH",
    ...fileErrorCodes,
    "INTERNAL_ERROR",
  ])
  .meta({ id: "ApiErrorCode" })
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>
export const ApiErrorSchema = z
  .strictObject({
    code: ApiErrorCodeSchema,
    message: z.string(),
    requestId: z.string().min(1),
    locale: SupportedLocaleSchema,
    details: FileErrorDetailsSchema.optional(),
  })
  .meta({ id: "ApiError" })
export type ApiError = z.infer<typeof ApiErrorSchema>
