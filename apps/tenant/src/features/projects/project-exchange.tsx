import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { FormDialog } from "@workspace/admin"
import {
  ApiClientError,
  createProjectImport,
  createProjectExport,
  getOrganizationAccessOptions,
  organizationKeys,
  requestLanguageHeader,
} from "@workspace/api-client"
import {
  BusinessTaskSchema,
  CreateProjectImportSchema,
  CreateProjectExportSchema,
  ExchangeFormatSchema,
  PROJECT_IMPORT_MAX_BYTES,
  ProjectExportFilterSchema,
  type BusinessTask,
} from "@workspace/contracts/framework-capabilities"
import { type ProjectListQuery } from "@workspace/contracts/project-query"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldLabel,
  FieldGroup,
  FieldError,
  FieldDescription,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { authClient } from "@/lib/auth-client"

type Props = {
  organizationId: string
  filter: ProjectListQuery
  onTaskCreated: (task: BusinessTask) => void
}
export function ProjectExchangeActions(props: Props) {
  const session = useAuthenticatedSession()
  return session ? (
    <ExchangeScope
      key={`${props.organizationId}:${session.user.id}`}
      {...props}
      userId={session.user.id}
    />
  ) : null
}
function ExchangeScope(props: Props & { userId: string }) {
  const access = useQuery(getOrganizationAccessOptions(props.organizationId))
  const version = access.data?.data.authorizationVersion ?? 0
  const permissions = useQuery({
    queryKey: [
      ...organizationKeys.scope(props.organizationId),
      "exchange-permissions",
      props.userId,
      version,
    ],
    enabled: access.isSuccess,
    retry: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const check = async (action: "create" | "export") => {
        const reply = await authClient.organization.hasPermission({
          organizationId: props.organizationId,
          permissions: { project: [action] },
          fetchOptions: { signal },
        })
        if (reply.error) throw new Error(reply.error.message)
        return reply.data.success
      }
      const [canImport, canExport] = await Promise.all([
        check("create"),
        check("export"),
      ])
      return { canImport, canExport }
    },
  })
  const ready =
    access.isSuccess &&
    permissions.isSuccess &&
    !access.isError &&
    !permissions.isError
  const canImport = ready && permissions.data?.canImport === true
  const canExport = ready && permissions.data?.canExport === true
  return ready ? (
    <ExchangeControls
      key={version}
      {...props}
      canImport={canImport}
      canExport={canExport}
    />
  ) : null
}
function ExchangeControls(
  props: Props & { canImport: boolean; canExport: boolean }
) {
  const { t } = useTranslation("tasks")
  const [kind, setKind] = useState<"import" | "export" | null>(null)
  const { canImport, canExport } = props
  return (
    <>
      {canImport && (
        <Button variant="outline" onClick={() => setKind("import")}>
          {t("importProjects")}
        </Button>
      )}
      {canExport && (
        <Button variant="outline" onClick={() => setKind("export")}>
          {t("exportProjects")}
        </Button>
      )}
      {kind && (
        <ExchangeDialog
          key={kind}
          {...props}
          kind={kind}
          onClose={() => setKind(null)}
        />
      )}
    </>
  )
}
function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("FILE_READ_FAILED"))
        return
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1))
    }
    reader.readAsDataURL(file)
  })
}
function exchangeFormSchema(
  kind: "import" | "export",
  messages: { selectFile: string; fileTooLarge: string }
) {
  return z
    .strictObject({
      format: ExchangeFormatSchema,
      file: z.instanceof(File).nullable(),
    })
    .superRefine((value, context) => {
      if (kind === "import" && value.file === null)
        context.addIssue({
          code: "custom",
          path: ["file"],
          message: messages.selectFile,
        })
      if (
        kind === "import" &&
        value.file !== null &&
        value.file.size > PROJECT_IMPORT_MAX_BYTES
      )
        context.addIssue({
          code: "custom",
          path: ["file"],
          message: messages.fileTooLarge,
        })
    })
}
function ExchangeDialog(
  props: Props & { kind: "import" | "export"; onClose: () => void }
) {
  const { t } = useTranslation(["tasks", "common", "errors"])
  const locale = useUiLocale()
  const id = useId()
  const controller = useRef<AbortController | null>(null)
  const intent = useRef<{ fingerprint: string; key: string } | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const mutation = useMutation({
    retry: false,
    mutationFn: async (value: {
      format: ReturnType<typeof ExchangeFormatSchema.parse>
      file: File | null
    }) => {
      const active = new AbortController()
      controller.current = active
      const applied = ProjectExportFilterSchema.strip().parse(props.filter)
      const body =
        props.kind === "import"
          ? CreateProjectImportSchema.parse({
              format: value.format,
              contentBase64: await fileBase64(value.file!),
            })
          : CreateProjectExportSchema.parse({
              format: value.format,
              filter: ProjectExportFilterSchema.parse(applied),
            })
      active.signal.throwIfAborted()
      const fingerprint = JSON.stringify([
        props.organizationId,
        props.kind,
        locale,
        body,
      ])
      // 同一意图在结果未知后重试仍使用原key；改变文件、格式或筛选则是新意图。
      if (intent.current?.fingerprint !== fingerprint)
        intent.current = { fingerprint, key: crypto.randomUUID() }
      const headers = { "Idempotency-Key": intent.current.key }
      const options = {
        signal: active.signal,
        headers: { [requestLanguageHeader]: locale },
      }
      const result =
        props.kind === "import"
          ? await createProjectImport(
              props.organizationId,
              CreateProjectImportSchema.parse(body),
              headers,
              options
            )
          : await createProjectExport(
              props.organizationId,
              CreateProjectExportSchema.parse(body),
              headers,
              options
            )
      active.signal.throwIfAborted()
      return BusinessTaskSchema.parse(result.data)
    },
  })
  const schema = exchangeFormSchema(props.kind, {
    selectFile: t("tasks:selectFile"),
    fileTooLarge: t("tasks:importFileTooLarge"),
  })
  const form = useForm({
    defaultValues: {
      format: ExchangeFormatSchema.parse("csv"),
      file: null as File | null,
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const task = await mutation.mutateAsync(value)
        props.onTaskCreated(task)
        props.onClose()
      } catch {
        /* mutation保存失败事实，输入与意图key保留供用户重试。 */
      }
    },
  })
  return (
    <form.Subscribe
      selector={(state) => ({
        pending: state.isSubmitting,
        format: state.values.format,
      })}
    >
      {({ pending, format }) => (
        <FormDialog
          open
          onOpenChange={(open) => {
            if (!open) props.onClose()
          }}
          title={
            props.kind === "import"
              ? t("tasks:importProjects")
              : t("tasks:exportProjects")
          }
          description={
            props.kind === "import"
              ? t("tasks:importHint")
              : t("tasks:exportHint")
          }
          pending={pending}
          onSubmit={() => void form.handleSubmit()}
          submitLabel={
            props.kind === "import"
              ? t("tasks:submitImport")
              : t("tasks:submitExport")
          }
          error={
            mutation.error
              ? mutation.error instanceof ApiClientError
                ? mutation.error.body.message
                : t("errors:INTERNAL_ERROR")
              : undefined
          }
        >
          <FieldGroup>
            <form.Field name="format">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${id}-format`}>
                    {t("tasks:format")}
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    items={{ csv: t("tasks:csv"), xlsx: t("tasks:xlsx") }}
                    onValueChange={(value) => {
                      if (value !== null)
                        field.handleChange(ExchangeFormatSchema.parse(value))
                    }}
                    disabled={pending}
                  >
                    <SelectTrigger
                      id={`${id}-format`}
                      onBlur={field.handleBlur}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="csv">{t("tasks:csv")}</SelectItem>
                      <SelectItem value="xlsx">{t("tasks:xlsx")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            {props.kind === "import" && (
              <form.Field name="file">
                {(field) => (
                  <Field
                    data-invalid={
                      field.state.meta.isTouched && !field.state.meta.isValid
                    }
                  >
                    <FieldLabel htmlFor={`${id}-file`}>
                      {t("tasks:file")}
                    </FieldLabel>
                    <Input
                      id={`${id}-file`}
                      required
                      aria-invalid={
                        field.state.meta.isTouched && !field.state.meta.isValid
                      }
                      type="file"
                      accept={
                        format === "csv"
                          ? ".csv,text/csv"
                          : ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      }
                      disabled={pending}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.files?.[0] ?? null)
                      }
                    />
                    <FieldDescription>
                      {t("tasks:importColumns")}
                    </FieldDescription>
                    {field.state.meta.isTouched &&
                      !field.state.meta.isValid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                  </Field>
                )}
              </form.Field>
            )}
          </FieldGroup>
        </FormDialog>
      )}
    </form.Subscribe>
  )
}
