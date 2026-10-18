import { z } from "zod"

export const ORGANIZATION_INVITATION_IMPORT_MAX_BYTES = 2 * 1024 * 1024
export const ORGANIZATION_INVITATION_IMPORT_MAX_ROWS = 500

export const CreateOrganizationInvitationImportSchema = z
  .strictObject({
    format: z.literal("xlsx"),
    role: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .refine((value) => value !== "owner" && !value.includes(",")),
    contentBase64: z
      .string()
      .max(Math.ceil(ORGANIZATION_INVITATION_IMPORT_MAX_BYTES / 3) * 4)
      .refine((value) => z.base64().safeParse(value).success, "Invalid base64")
      .refine(
        (value) =>
          (value.length / 4) * 3 -
            (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0) <=
          ORGANIZATION_INVITATION_IMPORT_MAX_BYTES
      ),
  })
  .meta({ id: "CreateOrganizationInvitationImport" })
export type CreateOrganizationInvitationImport = z.infer<
  typeof CreateOrganizationInvitationImportSchema
>

export const InvitationImportRowCodeSchema = z.enum([
  "INVITED",
  "DUPLICATE_IN_FILE",
  "MEMBER_ALREADY_EXISTS",
  "INVITATION_ALREADY_PENDING",
  "INVALID_EMAIL",
  "INVITATION_RATE_LIMITED",
  "INVITATION_LIMIT_REACHED",
  "ROLE_NOT_FOUND",
  "INVITATION_ROLE_FORBIDDEN",
  "PERMISSION_DENIED",
  "MEMBERSHIP_REQUIRED",
  "ORGANIZATION_SUSPENDED",
  "ACCOUNT_SUSPENDED",
  "AUTHORIZATION_UNAVAILABLE",
  "INVITATION_FAILED",
  "EXECUTION_FAILED",
])
export const InvitationImportSummarySchema = z
  .strictObject({
    invited: z.number().int().min(0),
    skipped: z.number().int().min(0),
    failed: z.number().int().min(0),
  })
  .meta({ id: "InvitationImportSummary" })
export const InvitationImportRowSchema = z
  .strictObject({
    row: z.number().int().min(2),
    email: z.string(),
    status: z.enum(["invited", "skipped", "failed"]),
    code: InvitationImportRowCodeSchema,
    invitationId: z.uuid().nullable(),
  })
  .meta({ id: "InvitationImportRow" })
export const InvitationImportReportSchema =
  InvitationImportSummarySchema.extend({
    rows: z.array(InvitationImportRowSchema),
    fileError: z
      .enum([
        "INVALID_FILE",
        "INVALID_COLUMNS",
        "INVALID_WORKSHEET_COUNT",
        "TOO_MANY_ROWS",
        "EMPTY_FILE",
      ])
      .optional(),
  }).meta({ id: "InvitationImportReport" })
export type InvitationImportReport = z.infer<
  typeof InvitationImportReportSchema
>
export type InvitationImportRow = z.infer<typeof InvitationImportRowSchema>
