import { useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useNavigate } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { FormDialog } from "@workspace/admin"
import {
  createOrganizationInvitationImport,
  getOrganizationInvitationImportTemplate,
} from "@workspace/api-client"
import { BusinessTaskSchema } from "@workspace/contracts"
import {
  CreateOrganizationInvitationImportSchema,
  ORGANIZATION_INVITATION_IMPORT_MAX_BYTES,
  ORGANIZATION_INVITATION_IMPORT_MAX_ROWS,
} from "@workspace/contracts/organization-invitations"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { parse as parseContentDisposition } from "content-disposition"

function bulkInvitationSchema(fileMessage: string, roleMessage: string) {
  return z.object({
    file: z.custom<File | null>(
      (file) =>
        file instanceof File &&
        file.name.toLowerCase().endsWith(".xlsx") &&
        file.size > 0 &&
        file.size <= ORGANIZATION_INVITATION_IMPORT_MAX_BYTES,
      fileMessage
    ),
    role: CreateOrganizationInvitationImportSchema.shape.role.refine(
      (value) => value.length > 0,
      roleMessage
    ),
  })
}

async function readBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(",")[1]!)
    reader.readAsDataURL(file)
  })
}

export function BulkInvitationAction({
  organizationId,
  roleOptions,
  canListRoles,
  roleLabel,
}: {
  organizationId: string
  roleOptions: string[]
  canListRoles: boolean
  roleLabel: (role: string) => string
}) {
  const navigate = useNavigate()
  const request = useRef<{ file: File; role: string; key: string } | null>(null)
  return (
    <BulkInvitationDialog
      roleOptions={roleOptions}
      canListRoles={canListRoles}
      roleLabel={roleLabel}
      onSubmit={async ({ file, role }) => {
        // 同一文件与角色的失败重试保留幂等键，避免网络响应丢失后重复创建任务。
        if (request.current?.file !== file || request.current.role !== role)
          request.current = { file, role, key: crypto.randomUUID() }
        const task = BusinessTaskSchema.parse(
          (
            await createOrganizationInvitationImport(
              organizationId,
              { format: "xlsx", role, contentBase64: await readBase64(file) },
              { "Idempotency-Key": request.current.key }
            )
          ).data
        )
        request.current = null
        return task.id
      }}
      onDownloadTemplate={async () => {
        const response =
          await getOrganizationInvitationImportTemplate(organizationId)
        const filename = parseContentDisposition(
          response.headers.get("content-disposition") ?? ""
        ).parameters.filename
        if (!filename) throw new Error("Missing authorized download filename")
        const url = URL.createObjectURL(response.data)
        try {
          const anchor = document.createElement("a")
          anchor.href = url
          anchor.download = filename
          anchor.click()
        } finally {
          setTimeout(() => URL.revokeObjectURL(url), 0)
        }
      }}
      onOpenTask={(taskId) =>
        void navigate({
          to: "/app/tasks/$organizationId",
          params: { organizationId },
          search: { page: 1, pageSize: 20, source: "business", taskId },
        })
      }
    />
  )
}

export function BulkInvitationDialog({
  roleOptions,
  canListRoles,
  roleLabel,
  onSubmit,
  onDownloadTemplate,
  onOpenTask,
}: {
  roleOptions: string[]
  canListRoles: boolean
  roleLabel: (role: string) => string
  onSubmit: (value: { file: File; role: string }) => Promise<string>
  onDownloadTemplate: () => Promise<void>
  onOpenTask: (id: string) => void
}) {
  const { t } = useTranslation(["organization", "common", "tasks"])
  const id = useId()
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [downloading, setDownloading] = useState(false)
  const form = useForm({
    defaultValues: { file: null as File | null, role: "member" },
    validators: {
      onSubmit: bulkInvitationSchema(
        t("organization:bulkInvitationFileInvalid"),
        t("organization:roleRequired")
      ),
    },
    onSubmit: async ({ value, formApi }) => {
      if (!value.file) return
      setError(undefined)
      try {
        const created = await onSubmit({ file: value.file, role: value.role })
        formApi.reset()
        setTaskId(created)
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : t("common:operationFailed")
        )
      }
    },
  })
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          form.reset()
          setTaskId(null)
          setError(undefined)
          setOpen(true)
        }}
      >
        {t("organization:bulkInvite")}
      </Button>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={open}
            onOpenChange={(value) => {
              if (!value) form.reset()
              setOpen(value)
            }}
            title={t("organization:bulkInvite")}
            description={t("organization:bulkInvitationDescription")}
            pending={pending}
            submitDisabled={downloading}
            error={error}
            submitLabel={
              taskId
                ? t("tasks:viewTask")
                : t("organization:submitBulkInvitation")
            }
            onSubmit={() =>
              taskId ? onOpenTask(taskId) : void form.handleSubmit()
            }
          >
            {taskId ? (
              <div role="status" className="space-y-2 text-sm">
                <p>{t("organization:bulkInvitationSubmitted")}</p>
                <p className="text-muted-foreground">
                  {t("organization:bulkInvitationReportHint")}
                </p>
              </div>
            ) : (
              <FieldGroup className="gap-4">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  disabled={downloading}
                  onClick={() => {
                    setDownloading(true)
                    setError(undefined)
                    void onDownloadTemplate()
                      .catch((failure: unknown) =>
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : t("common:operationFailed")
                        )
                      )
                      .finally(() => setDownloading(false))
                  }}
                >
                  {downloading
                    ? t("common:loading")
                    : t("organization:downloadInvitationTemplate")}
                </Button>
                <form.Field name="file">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-file`}>
                          {t("organization:invitationExcel")}
                        </FieldLabel>
                        <Input
                          id={`${id}-file`}
                          name={field.name}
                          type="file"
                          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          required
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.files?.[0] ?? null)
                          }
                        />
                        <FieldDescription>
                          {t("organization:bulkInvitationFileHint", {
                            maxRows: ORGANIZATION_INVITATION_IMPORT_MAX_ROWS,
                          })}
                        </FieldDescription>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="role">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-role`}>
                          {t("organization:role")}
                        </FieldLabel>
                        {canListRoles ? (
                          <Select
                            value={field.state.value}
                            items={Object.fromEntries(
                              roleOptions.map((role) => [role, roleLabel(role)])
                            )}
                            onValueChange={(value) =>
                              value !== null && field.handleChange(value)
                            }
                          >
                            <SelectTrigger
                              id={`${id}-role`}
                              aria-invalid={invalid}
                              onBlur={field.handleBlur}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roleOptions.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {roleLabel(role)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={`${id}-role`}
                            required
                            maxLength={48}
                            aria-invalid={invalid}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                          />
                        )}
                        <FieldDescription>
                          {t("organization:bulkInvitationRoleHint")}
                        </FieldDescription>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <p className="text-xs text-muted-foreground">
                  {t("organization:bulkInvitationSkipHint")}
                </p>
              </FieldGroup>
            )}
          </FormDialog>
        )}
      </form.Subscribe>
    </>
  )
}
