import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { FormDialog } from "@workspace/admin"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"

export type PlatformExportResource =
  | "employee"
  | "role"
  | "post"
  | "dictionary"
  | "dictionaryItem"
  | "parameter"
  | "audit"
  | "login"
  | "menu"
  | "department"
  | "user"
  | "organization"
  | "session"
export type EmployeeImportValue = {
  file: File
  initialPassword: string
  updateExisting: boolean
}
function importSchema(fileMessage: string, passwordMessage: string) {
  return z.object({
    file: z.custom<File | null>(
      (value) =>
        value instanceof File &&
        value.name.toLowerCase().endsWith(".xlsx") &&
        value.size <= 10 * 1024 ** 2,
      fileMessage
    ),
    initialPassword: z
      .string()
      .min(12, passwordMessage)
      .max(128, passwordMessage),
    updateExisting: z.boolean(),
  })
}
export function PlatformExportAction({
  onSubmit,
  onOpenTask,
}: {
  onSubmit: () => Promise<{ id: string }>
  onOpenTask?: (id: string) => void
}) {
  const { t } = useTranslation(["platformTasks", "common"])
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const form = useForm({
    defaultValues: {},
    validators: { onSubmit: z.object({}) },
    onSubmit: async () => {
      setError(undefined)
      try {
        const task = await onSubmit()
        setTaskId(task.id)
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : t("common:operationFailed")
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
          setTaskId(null)
          setError(undefined)
          setOpen(true)
        }}
      >
        {t("export")}
      </Button>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={open}
            onOpenChange={setOpen}
            title={t("export")}
            description={t("exportHint")}
            onSubmit={() =>
              taskId
                ? onOpenTask
                  ? onOpenTask(taskId)
                  : setOpen(false)
                : void form.handleSubmit()
            }
            pending={pending}
            error={error}
            submitLabel={
              taskId
                ? onOpenTask
                  ? t("viewTask")
                  : t("common:close")
                : t("submitExport")
            }
          >
            {taskId && (
              <div role="status" className="space-y-2">
                <p>{t("submitted")}</p>
                <p className="text-xs break-all text-muted-foreground">
                  {taskId}
                </p>
              </div>
            )}
          </FormDialog>
        )}
      </form.Subscribe>
    </>
  )
}
export function PlatformEmployeeImportAction({
  onSubmit,
  onDownloadTemplate,
  onOpenTask,
}: {
  onSubmit: (value: EmployeeImportValue) => Promise<{ id: string }>
  onDownloadTemplate: () => Promise<void>
  onOpenTask?: (id: string) => void
}) {
  const { t } = useTranslation(["platformTasks", "common"])
  const id = useId()
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [downloading, setDownloading] = useState(false)
  const form = useForm({
    defaultValues: {
      file: null as File | null,
      initialPassword: "",
      updateExisting: false,
    },
    validators: {
      onSubmit: importSchema(t("chooseFile"), t("passwordRequired")),
    },
    onSubmit: async ({ value, formApi }) => {
      if (!value.file) return
      setError(undefined)
      try {
        const task = await onSubmit({ ...value, file: value.file })
        // 临时密码仅用于本次提交，成功后立即清空表单内存。
        formApi.reset()
        setTaskId(task.id)
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : t("common:operationFailed")
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
        {t("importEmployees")}
      </Button>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={open}
            onOpenChange={(value) => {
              if (!value) form.reset()
              setOpen(value)
            }}
            title={t("importEmployees")}
            description={t("importHint")}
            onSubmit={() =>
              taskId
                ? onOpenTask
                  ? onOpenTask(taskId)
                  : setOpen(false)
                : void form.handleSubmit()
            }
            pending={pending}
            error={error}
            submitDisabled={downloading}
            submitLabel={
              taskId
                ? onOpenTask
                  ? t("viewTask")
                  : t("common:close")
                : t("submitImport")
            }
          >
            {taskId ? (
              <div role="status" className="space-y-2">
                <p>{t("submitted")}</p>
                <p className="text-xs break-all text-muted-foreground">
                  {taskId}
                </p>
              </div>
            ) : (
              <FieldGroup>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={downloading}
                  onClick={() => {
                    setDownloading(true)
                    setError(undefined)
                    void onDownloadTemplate()
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : t("common:operationFailed")
                        )
                      )
                      .finally(() => setDownloading(false))
                  }}
                >
                  {t("downloadTemplate")}
                </Button>
                <form.Field name="file">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-file`}>
                          {t("file")}
                        </FieldLabel>
                        <Input
                          id={`${id}-file`}
                          name={field.name}
                          type="file"
                          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                          required
                          onChange={(event) =>
                            field.handleChange(event.target.files?.[0] ?? null)
                          }
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                        />
                        <FieldDescription>{t("fileLimit")}</FieldDescription>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="initialPassword">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-password`}>
                          {t("initialPassword")}
                        </FieldLabel>
                        <Input
                          id={`${id}-password`}
                          name={field.name}
                          type="password"
                          autoComplete="new-password"
                          value={field.state.value}
                          required
                          minLength={12}
                          maxLength={128}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="updateExisting">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field orientation="horizontal" data-invalid={invalid}>
                        <Checkbox
                          id={`${id}-update`}
                          name={field.name}
                          checked={field.state.value}
                          onCheckedChange={(value) =>
                            field.handleChange(value === true)
                          }
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                        />
                        <div className="space-y-1">
                          <FieldLabel htmlFor={`${id}-update`}>
                            {t("updateExisting")}
                          </FieldLabel>
                          <FieldDescription>{t("updateHint")}</FieldDescription>
                        </div>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
            )}
          </FormDialog>
        )}
      </form.Subscribe>
    </>
  )
}
