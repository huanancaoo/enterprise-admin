import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
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
} from "@workspace/contracts"
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

function avatarDraftSchema(t: TFunction<["settings", "errors"]>) {
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

function AvatarDraft({ file, label }: { file: File; label: string }) {
  const ref = useBlobImageRef(file)
  return (
    <figure>
      <img
        className="size-24 rounded-full object-cover"
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
      onChange: avatarDraftSchema(t),
      onSubmit: avatarDraftSchema(t),
    },
    onSubmit: async ({ value }) => {
      if (!value.file) return
      setError(undefined)
      setSaved(false)
      const controller = new AbortController()
      uploadRequest.current = controller
      try {
        const result = await uploadPersonalMedia(
          value.file,
          { "Idempotency-Key": uploadKey },
          {
            headers: { "Content-Type": value.file.type },
            signal: controller.signal,
          }
        )
        setUploaded(PersonalMediaUploadResultSchema.parse(result.data))
      } catch (error) {
        setError(
          error instanceof ApiClientError
            ? t("avatarUploadError", {
                reason: t(error.body.code, { ns: "errors" }),
              })
            : t("avatarUploadUnknown")
        )
        if (error instanceof ApiClientError && error.status === 401)
          await refetchSession()
      }
    },
  })
  async function save(mediaId: string | null) {
    setSaving(true)
    setError(undefined)
    setSaved(false)
    if (!saveAttempt.current || saveAttempt.current.mediaId !== mediaId)
      saveAttempt.current = {
        mediaId,
        expectedImage: session.user.image ?? null,
        idempotencyKey: crypto.randomUUID(),
      }
    try {
      // 显式重试未知结果必须复用整个 CAS 请求，不能因身份读回变化只复用 key。
      const response = await setPersonalAvatar(saveAttempt.current)
      PersonalAvatarResultSchema.parse(response.data)
      // 收据确认后重新取唯一 User.image；草稿与上传完成都不能乐观替换现头像。
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
          ? t("avatarSaveError", {
              reason: t(error.body.code, { ns: "errors" }),
            })
          : t("avatarSaveUnknown")
      )
      if (error instanceof ApiClientError) {
        await refetchSession()
        // CAS 拒绝未提交；明确的下一次保存要重新比较当前头像，不能复用旧请求事实。
        if (error.status === 409) saveAttempt.current = undefined
      }
    } finally {
      setSaving(false)
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {t("avatarTitle")}
      </h2>
      <div className="flex items-center gap-3">
        <PersonalAvatar
          image={session.user.image}
          name={session.user.name}
          className="size-16"
        />
        <p>{t("avatarCurrent")}</p>
      </div>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(uploading) => (
          <form
            className="space-y-4"
            aria-busy={uploading || saving}
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <fieldset className="space-y-4" disabled={uploading || saving}>
              <form.Field name="file">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${id}-file`}>
                        {t("avatarChoose")}
                      </FieldLabel>
                      <Input
                        id={`${id}-file`}
                        name={field.name}
                        type="file"
                        ref={input}
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
                      <FieldDescription id={`${id}-hint`}>
                        {t("avatarHint")}
                      </FieldDescription>
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                      {field.state.value && !invalid ? (
                        <AvatarDraft
                          file={field.state.value}
                          label={t("avatarDraft")}
                        />
                      ) : null}
                    </Field>
                  )
                }}
              </form.Field>
              {uploaded ? <p role="status">{t("avatarUploaded")}</p> : null}
              {saved ? <p role="status">{t("avatarSaved")}</p> : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={uploading || saving || Boolean(uploaded)}
                >
                  {uploading ? t("avatarUploading") : t("avatarUpload")}
                </Button>
                <Button
                  type="button"
                  disabled={uploading || saving || !uploaded}
                  onClick={() => void save(uploaded!.media.id)}
                >
                  {saving ? t("avatarSaving") : t("avatarSave")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading || saving || !session.user.image}
                  onClick={() => void save(null)}
                >
                  {t("avatarRemove")}
                </Button>
              </div>
            </fieldset>
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}
