import { AdminPage } from "@workspace/admin"
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
  onPickImage,
  onPickAttachment,
  onSave,
  onBack,
}: {
  mode: "create" | "edit"
  initialValue: AnnouncementDraftValue
  ports: FileContentPorts
  onUploadImage?: NonNullable<RichTextEditorProps["onUploadImage"]>
  onUploadAttachment?: (
    file: File,
    signal: AbortSignal
  ) => Promise<AnnouncementAttachment>
  onPickImage?: RichTextEditorProps["onPickImage"]
  onPickAttachment?: (
    signal: AbortSignal
  ) => Promise<AnnouncementAttachment | null>
  onSave: (value: AnnouncementDraftValue) => Promise<void>
  onBack: () => void
}) {
  const { t } = useTranslation(["announcements", "common"])
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [uploads, setUploads] = useState(0)
  const attachmentPickerButton = useRef<HTMLButtonElement>(null)
  const restoreAttachmentFocus = useRef(false)
  const attachmentControllers = useRef(new Set<AbortController>())
  useEffect(() => {
    // 选择期间按钮被禁用；等表单解除忙碌状态后再归还焦点，弹窗自身无法聚焦禁用按钮。
    if (uploads === 0 && restoreAttachmentFocus.current) {
      restoreAttachmentFocus.current = false
      attachmentPickerButton.current?.focus()
    }
  }, [uploads])
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
      return await onUploadImage!(file, options)
    } finally {
      setUploads((value) => value - 1)
    }
  }
  return (
    <AdminPage
      title={t(mode === "create" ? "new" : "edit")}
      back={
        <Button variant="ghost" size="sm" onClick={onBack}>
          {t("back")}
        </Button>
      }
      contentWidth="reading"
    >
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
              {/* 字段固定纵向排列，无需尺寸查询；异步正文和附件状态变化仍需撑开表单。 */}
              <FieldGroup className="@container-normal">
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
                            ariaLabel={t("body")}
                            variant="document"
                            value={field.state.value as JSONContent}
                            onChange={field.handleChange}
                            onUploadImage={
                              onUploadImage ? uploadImage : undefined
                            }
                            onPickImage={onPickImage}
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
                                key={JSON.stringify([
                                  file.fileId,
                                  file.versionId,
                                ])}
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
                        {onPickAttachment && (
                          <Button
                            ref={attachmentPickerButton}
                            type="button"
                            variant="outline"
                            disabled={uploads > 0}
                            onClick={() => {
                              const controller = new AbortController()
                              attachmentControllers.current.add(controller)
                              setUploads((value) => value + 1)
                              setError(null)
                              void onPickAttachment(controller.signal)
                                .then((result) => {
                                  if (
                                    result &&
                                    !controller.signal.aborted &&
                                    !field.state.value.some(
                                      (item) =>
                                        item.fileId === result.fileId &&
                                        item.versionId === result.versionId
                                    )
                                  )
                                    field.pushValue(result)
                                })
                                .catch((cause: unknown) => {
                                  if (!controller.signal.aborted)
                                    setError(
                                      cause instanceof Error
                                        ? cause.message
                                        : t("common:operationFailed")
                                    )
                                })
                                .finally(() => {
                                  attachmentControllers.current.delete(
                                    controller
                                  )
                                  if (!controller.signal.aborted) {
                                    restoreAttachmentFocus.current = true
                                    setUploads((value) => value - 1)
                                  }
                                })
                            }}
                          >
                            {t("selectLibraryAttachment")}
                          </Button>
                        )}
                        {onUploadAttachment && (
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
                              void onUploadAttachment!(file, controller.signal)
                                .then((result) => field.pushValue(result))
                                .catch((cause: unknown) =>
                                  setError(
                                    cause instanceof Error
                                      ? cause.message
                                      : t("common:operationFailed")
                                  )
                                )
                                .finally(() => {
                                  attachmentControllers.current.delete(
                                    controller
                                  )
                                  setUploads((value) => value - 1)
                                })
                            }}
                          />
                        )}
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
    </AdminPage>
  )
}
