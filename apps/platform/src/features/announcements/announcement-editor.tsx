import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  RichTextEditor,
  type JSONContent,
  type RichTextEditorProps,
  type FileContentPorts,
} from "@workspace/admin/rich-text-editor"
import {
  AnnouncementAttachmentSchema,
  AnnouncementRichTextDocumentSchema,
  type AnnouncementDetail,
} from "@workspace/contracts/platform-announcements"
type AnnouncementAttachment = AnnouncementDetail["attachments"][number]
import { Button } from "@workspace/ui/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"

export type AnnouncementDraftValue = Pick<
  AnnouncementDetail,
  "title" | "type" | "content" | "attachments"
>
function createSchema(titleMessage: string) {
  return z.object({
    type: z.enum(["notice", "announcement"]),
    title: z.string().trim().min(1, titleMessage).max(200, titleMessage),
    content: AnnouncementRichTextDocumentSchema,
    attachments: z.array(AnnouncementAttachmentSchema),
  })
}
export function AnnouncementEditor({
  mode,
  initialValue,
  ports,
  onUploadImage,
  onUploadAttachment,
  onSave,
  onBack,
}: {
  mode: "create" | "edit"
  initialValue: AnnouncementDraftValue
  ports: FileContentPorts
  onUploadImage: NonNullable<RichTextEditorProps["onUploadImage"]>
  onUploadAttachment: (
    file: File,
    signal: AbortSignal
  ) => Promise<AnnouncementAttachment>
  onSave: (value: AnnouncementDraftValue) => Promise<void>
  onBack: () => void
}) {
  const { t } = useTranslation(["announcements", "common"])
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState(0)
  const attachmentControllers = useRef(new Set<AbortController>())
  useEffect(() => {
    const controllers = attachmentControllers.current
    return () => {
      for (const controller of controllers) controller.abort()
    }
  }, [])
  const form = useForm({
    // 富文本作为一个完整值管理，不把递归文档节点展开为表单字段路径。
    defaultValues: {
      ...initialValue,
      content: initialValue.content as unknown,
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = createSchema(t("titleRequired")).safeParse(value)
        if (result.success) return undefined
        return {
          fields: Object.fromEntries(
            result.error.issues.map((issue) => [
              issue.path[0],
              { message: issue.message },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      setError(null)
      try {
        await onSave(createSchema(t("titleRequired")).parse(value))
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : t("common:operationFailed")
        )
      }
    },
  })
  const uploadImage: NonNullable<RichTextEditorProps["onUploadImage"]> = async (
    file,
    options
  ) => {
    setUploads((value) => value + 1)
    try {
      return await onUploadImage(file, options)
    } finally {
      setUploads((value) => value - 1)
    }
  }
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">
          {t(mode === "create" ? "new" : "edit")}
        </h1>
        <Button variant="outline" size="sm" onClick={onBack}>
          {t("back")}
        </Button>
      </header>
      <p className="text-sm text-muted-foreground">{t("batchHint")}</p>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <form
            noValidate
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault()
              if (!uploads) void form.handleSubmit()
            }}
          >
            <fieldset disabled={pending} className="space-y-5">
              <FieldGroup>
                <form.Field name="title">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-title`}>
                          {t("subject")}
                        </FieldLabel>
                        <Input
                          id={`${id}-title`}
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          required
                          maxLength={200}
                          aria-invalid={invalid}
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="type">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid} className="max-w-xs">
                        <FieldLabel htmlFor={`${id}-type`}>
                          {t("type")}
                        </FieldLabel>
                        <Select
                          value={field.state.value}
                          items={{
                            notice: t("notice"),
                            announcement: t("announcement"),
                          }}
                          onValueChange={(value) => {
                            if (value === "notice" || value === "announcement")
                              field.handleChange(value)
                          }}
                        >
                          <SelectTrigger
                            id={`${id}-type`}
                            aria-invalid={invalid}
                            onBlur={field.handleBlur}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="notice">
                              {t("notice")}
                            </SelectItem>
                            <SelectItem value="announcement">
                              {t("announcement")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="content">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-content`}>
                          {t("body")}
                        </FieldLabel>
                        <div
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                          inert={pending}
                        >
                          <RichTextEditor
                            id={`${id}-content`}
                            variant="document"
                            value={field.state.value as JSONContent}
                            onChange={field.handleChange}
                            onUploadImage={uploadImage}
                            className="rounded-xl"
                            {...ports}
                          />
                        </div>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="attachments" mode="array">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-attachments`}>
                          {t("attachments")}
                        </FieldLabel>
                        {field.state.value.length > 0 && (
                          <ul className="space-y-2">
                            {field.state.value.map((file, index) => (
                              <li
                                key={file.fileId}
                                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                              >
                                <span className="min-w-0 text-sm break-words">
                                  {file.name}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={uploads > 0}
                                  onClick={() => field.removeValue(index)}
                                  aria-label={`${t("removeAttachment")}: ${file.name}`}
                                >
                                  {t("removeAttachment")}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <Input
                          id={`${id}-attachments`}
                          type="file"
                          disabled={uploads > 0}
                          aria-label={t("uploadAttachment")}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            event.target.value = ""
                            if (!file) return
                            setError(null)
                            setUploads((value) => value + 1)
                            const controller = new AbortController()
                            attachmentControllers.current.add(controller)
                            void onUploadAttachment(file, controller.signal)
                              .then((result) => field.pushValue(result))
                              .catch((cause: unknown) =>
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : t("common:operationFailed")
                                )
                              )
                              .finally(() => {
                                attachmentControllers.current.delete(controller)
                                setUploads((value) => value - 1)
                              })
                          }}
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
              {uploads > 0 && (
                <FieldDescription role="status">
                  {t("fileUploading")}
                </FieldDescription>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={pending || uploads > 0}>
                {pending ? t("common:submitting") : t("save")}
              </Button>
            </fieldset>
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}
