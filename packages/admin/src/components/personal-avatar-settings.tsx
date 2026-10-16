import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Upload } from "lucide-react"
import { z } from "zod"
import {
  ApiClientError,
  uploadPersonalMedia,
  setPersonalAvatar,
} from "@workspace/api-client"
import {
  personalMediaMaximumBytes,
  PersonalMediaContentTypeSchema,
  PersonalMediaUploadResultSchema,
  PersonalAvatarResultSchema,
  type PersonalMediaUploadResult,
  type SetPersonalAvatar,
} from "@workspace/contracts/personal-media"
import type { TFunction } from "@workspace/i18n"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { useAuthenticatedSession } from "../auth/authenticated-session"
import type { WorkspaceAuthClient } from "../auth/client"
import { PersonalAvatar } from "./personal-avatar"
import { useBlobImageRef } from "../hooks/use-blob-image-ref"

function avatarSelectionSchema(t: TFunction<["settings", "errors"]>) {
  return z.object({
    file: z
      .file()
      .min(1, t("settings:avatarInvalid"))
      .max(personalMediaMaximumBytes, t("settings:avatarTooLarge"))
      .mime(PersonalMediaContentTypeSchema.options, t("settings:avatarInvalid"))
      .nullable()
      .refine((file) => file !== null, t("settings:avatarSelectRequired")),
  })
}

function AvatarPreview({ file, label }: { file: File; label: string }) {
  const ref = useBlobImageRef(file)
  return (
    <figure className="shrink-0">
      <img
        className="size-20 rounded-full object-cover ring-1 ring-border @md:size-28"
        ref={ref}
        alt={label}
      />
    </figure>
  )
}

export function PersonalAvatarSettings({
  client,
}: {
  client: WorkspaceAuthClient
}) {
  const { t } = useTranslation(["settings", "errors"])
  const session = useAuthenticatedSession()!
  const { refetch: refetchSession } = client.useSession()
  const queryClient = useQueryClient()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const uploadRequest = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => uploadRequest.current?.abort(), [])
  const [uploaded, setUploaded] = useState<PersonalMediaUploadResult>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [uploadKey, setUploadKey] = useState(() => crypto.randomUUID())
  const saveAttempt = useRef<SetPersonalAvatar | undefined>(undefined)
  const form = useForm({
    defaultValues: { file: null as File | null },
    validators: {
      onChange: avatarSelectionSchema(t),
      onSubmit: avatarSelectionSchema(t),
    },
    onSubmit: async ({ value }) => {
      if (value.file) await save(value.file)
    },
  })
  async function save(file?: File) {
    setSaving(true)
    setError(undefined)
    setSaved(false)
    let saveRequestStarted = false
    try {
      let mediaId: string | null = null
      if (file) {
        let receipt = uploaded
        if (!receipt) {
          const controller = new AbortController()
          uploadRequest.current = controller
          const result = await uploadPersonalMedia(
            file,
            { "idempotency-key": uploadKey },
            {
              headers: { "Content-Type": file.type },
              signal: controller.signal,
            }
          )
          receipt = PersonalMediaUploadResultSchema.parse(result.data)
          setUploaded(receipt)
        }
        mediaId = receipt.media.id
      }
      if (!saveAttempt.current || saveAttempt.current.mediaId !== mediaId)
        saveAttempt.current = {
          mediaId,
          expectedImage: session.user.image ?? null,
          idempotencyKey: crypto.randomUUID(),
        }
      // 显式重试未知结果必须复用整个 CAS 请求，不能因身份读回变化只复用 key。
      saveRequestStarted = true
      const response = await setPersonalAvatar(saveAttempt.current)
      PersonalAvatarResultSchema.parse(response.data)
      // 收据确认后重新取唯一 User.image；预览与上传完成都不能乐观替换现头像。
      await refetchSession()
      await queryClient.invalidateQueries({ queryKey: ["organizations"] })
      form.reset()
      if (input.current) input.current.value = ""
      setUploaded(undefined)
      setUploadKey(crypto.randomUUID())
      saveAttempt.current = undefined
      setSaved(true)
    } catch (error) {
      setError(
        error instanceof ApiClientError
          ? t(file ? "avatarSaveError" : "avatarRemoveError", {
              reason: t(error.body.code, { ns: "errors" }),
            })
          : t("avatarSaveUnknown")
      )
      if (error instanceof ApiClientError) {
        await refetchSession()
        // CAS 拒绝未提交；明确的下一次保存要重新比较当前头像，不能复用旧请求事实。
        if (saveRequestStarted && error.status === 409)
          saveAttempt.current = undefined
      }
    } finally {
      setSaving(false)
    }
  }
  return (
    <section
      className="@container space-y-6 rounded-xl border p-5 sm:p-6"
      aria-labelledby={`${id}-title`}
    >
      <header className="space-y-1.5 border-b pb-5">
        <h2 id={`${id}-title`} className="text-xl font-semibold">
          {t("avatarTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("avatarDescription")}
        </p>
      </header>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <form
            className="space-y-4"
            aria-busy={submitting || saving}
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <fieldset className="space-y-4" disabled={submitting || saving}>
              <form.Field name="file">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  const selected = invalid ? null : field.state.value
                  return (
                    <Field
                      orientation="horizontal"
                      data-invalid={invalid}
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-5 gap-y-4 @min-[42rem]:grid-cols-[auto_minmax(0,1fr)_auto] @min-[42rem]:items-center"
                    >
                      {selected ? (
                        <AvatarPreview
                          file={selected}
                          label={t("avatarPreview")}
                        />
                      ) : (
                        <PersonalAvatar
                          image={session.user.image}
                          name={session.user.name}
                          className="size-20 shrink-0 ring-1 ring-border @md:size-28"
                        />
                      )}
                      <div className="min-w-0 space-y-3">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                          <p className="text-base font-medium">
                            {t(selected ? "avatarPreview" : "avatarCurrent")}
                          </p>
                          {selected ? (
                            <p className="text-muted-foreground">
                              <span aria-hidden="true" className="me-2">
                                ·
                              </span>
                              {t("avatarPending")}
                            </p>
                          ) : null}
                        </div>
                        <FieldLabel htmlFor={`${id}-file`} className="sr-only">
                          {t("avatarChoose")}
                        </FieldLabel>
                        <Input
                          id={`${id}-file`}
                          name={field.name}
                          type="file"
                          ref={input}
                          hidden
                          accept={PersonalMediaContentTypeSchema.options.join(
                            ","
                          )}
                          aria-invalid={invalid}
                          aria-describedby={`${id}-hint`}
                          onBlur={field.handleBlur}
                          onChange={(event) => {
                            field.handleChange(event.target.files?.[0] ?? null)
                            field.handleBlur()
                            setUploaded(undefined)
                            setUploadKey(crypto.randomUUID())
                            saveAttempt.current = undefined
                            setError(undefined)
                            setSaved(false)
                          }}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            aria-describedby={`${id}-hint`}
                            onClick={() => input.current?.click()}
                          >
                            <Upload
                              aria-hidden="true"
                              data-icon="inline-start"
                            />
                            {t("avatarChooseButton")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className="text-muted-foreground"
                            disabled={!session.user.image}
                            onClick={() => void save()}
                          >
                            {t("avatarRemove")}
                          </Button>
                        </div>
                        <FieldDescription id={`${id}-hint`}>
                          {t("avatarHint")}
                        </FieldDescription>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </div>
                      <Button
                        type="submit"
                        size="lg"
                        className="col-start-2 min-w-28 justify-self-start @min-[42rem]:col-start-3 @min-[42rem]:row-start-1 @min-[42rem]:justify-self-end"
                        disabled={!selected}
                      >
                        {saving ? t("avatarSaving") : t("avatarSave")}
                      </Button>
                    </Field>
                  )
                }}
              </form.Field>
              {saved ? <p role="status">{t("avatarSaved")}</p> : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </fieldset>
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}
