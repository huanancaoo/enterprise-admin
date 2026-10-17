import { z } from "zod"
import { UserIdSchema } from "./identifiers.js"

export const AccountStatusSchema = z.enum(["active", "suspended"])
export type AccountStatus = z.infer<typeof AccountStatusSchema>
export const CreatePlatformUserSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .meta({ id: "CreatePlatformUser" })
export type CreatePlatformUser = z.infer<typeof CreatePlatformUserSchema>
export const UpdatePlatformUserSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "UpdatePlatformUser" })
export type UpdatePlatformUser = z.infer<typeof UpdatePlatformUserSchema>
export const SetPlatformUserStatusSchema = z
  .strictObject({
    status: AccountStatusSchema,
    expectedVersion: z.number().int().min(1),
  })
  .meta({ id: "SetPlatformUserStatus" })
export type SetPlatformUserStatus = z.infer<typeof SetPlatformUserStatusSchema>
export const PlatformUserMutationResultSchema = z
  .strictObject({
    userId: UserIdSchema,
    name: z.string(),
    status: AccountStatusSchema,
    version: z.number().int().min(1),
    changed: z.boolean(),
  })
  .meta({ id: "PlatformUserMutationResult" })
export type PlatformUserMutationResult = z.infer<
  typeof PlatformUserMutationResultSchema
>

const pagination = {
  page: z.coerce.number().int().min(1).max(2_147_483_647).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}
export const LoginMethodSchema = z.enum(["email", "github", "totp"])
export type LoginMethod = z.infer<typeof LoginMethodSchema>
export const LoginResultSchema = z.enum(["succeeded", "failed"])
export type LoginResult = z.infer<typeof LoginResultSchema>
export const LoginReasonCodeSchema = z.enum([
  "PASSWORD_LOGIN_LOCKED",
  "INVALID_CREDENTIALS",
  "EMAIL_NOT_VERIFIED",
  "INVALID_OTP",
  "ACCOUNT_SUSPENDED",
  "AUTHORIZATION_UNAVAILABLE",
  "AUTHENTICATION_FAILED",
])
export type LoginReasonCode = z.infer<typeof LoginReasonCodeSchema>
const loginFilters = {
  result: LoginResultSchema.optional(),
  method: LoginMethodSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  ...pagination,
}
export const LoginLogsQuerySchema = z
  .strictObject({
    q: z.string().trim().max(200).optional(),
    userId: UserIdSchema.optional(),
    ...loginFilters,
  })
  .meta({ id: "LoginLogsQuery" })
export type LoginLogsQuery = z.infer<typeof LoginLogsQuerySchema>
export const PersonalLoginLogsQuerySchema = z
  .strictObject(loginFilters)
  .meta({ id: "PersonalLoginLogsQuery" })
export type PersonalLoginLogsQuery = z.infer<
  typeof PersonalLoginLogsQuerySchema
>
export const LoginLogSchema = z
  .strictObject({
    id: z.uuid(),
    userId: UserIdSchema.nullable(),
    name: z.string().nullable(),
    maskedEmail: z.string().nullable(),
    occurredAt: z.iso.datetime({ offset: true }),
    method: LoginMethodSchema,
    result: LoginResultSchema,
    reasonCode: LoginReasonCodeSchema.nullable(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  })
  .meta({ id: "LoginLog" })
export type LoginLog = z.infer<typeof LoginLogSchema>
export const LoginLogsPageSchema = z
  .strictObject({
    items: z.array(LoginLogSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .meta({ id: "LoginLogsPage" })
export type LoginLogsPage = z.infer<typeof LoginLogsPageSchema>
// 只在平台管理投影读取当前账号锁状态；登录历史与个人记录不保存此可变状态。
export const PlatformLoginLogSchema = LoginLogSchema.extend({
  lockedUntil: z.iso.datetime({ offset: true }).nullable(),
}).meta({ id: "PlatformLoginLog" })
export type PlatformLoginLog = z.infer<typeof PlatformLoginLogSchema>
export const PlatformLoginLogsPageSchema = LoginLogsPageSchema.extend({
  items: z.array(PlatformLoginLogSchema),
}).meta({ id: "PlatformLoginLogsPage" })
export type PlatformLoginLogsPage = z.infer<typeof PlatformLoginLogsPageSchema>

export const PlatformSessionsQuerySchema = z
  .strictObject({
    q: z.string().trim().max(200).optional(),
    userId: UserIdSchema.optional(),
    ...pagination,
  })
  .meta({ id: "PlatformSessionsQuery" })
export type PlatformSessionsQuery = z.infer<typeof PlatformSessionsQuerySchema>
export const PlatformSessionSchema = z
  .strictObject({
    sessionId: z.uuid(),
    userId: UserIdSchema,
    name: z.string(),
    maskedEmail: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  })
  .meta({ id: "PlatformSession" })
export type PlatformSession = z.infer<typeof PlatformSessionSchema>
export const PlatformSessionsPageSchema = z
  .strictObject({
    items: z.array(PlatformSessionSchema),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
  })
  .meta({ id: "PlatformSessionsPage" })
export type PlatformSessionsPage = z.infer<typeof PlatformSessionsPageSchema>
export const SessionRevokeResultSchema = z
  .strictObject({
    sessionId: z.uuid(),
    revoked: z.boolean(),
  })
  .meta({ id: "SessionRevokeResult" })
export type SessionRevokeResult = z.infer<typeof SessionRevokeResultSchema>

export const PasswordResetRequestResultSchema = z
  .strictObject({ requested: z.literal(true) })
  .meta({ id: "PasswordResetRequestResult" })
export type PasswordResetRequestResult = z.infer<
  typeof PasswordResetRequestResultSchema
>

export const PasswordLoginUnlockResultSchema = z
  .strictObject({
    userId: UserIdSchema,
    changed: z.boolean(),
    lockedUntil: z.null(),
  })
  .meta({ id: "PasswordLoginUnlockResult" })
export type PasswordLoginUnlockResult = z.infer<
  typeof PasswordLoginUnlockResultSchema
>
