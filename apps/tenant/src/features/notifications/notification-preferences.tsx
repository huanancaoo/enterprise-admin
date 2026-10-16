import { useEffect, useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  organizationKeys,
} from "@workspace/api-client"
import { NotificationPreferencesSchema } from "@workspace/contracts/framework-capabilities"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { ErrorState, LoadingState } from "@workspace/admin"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"

export function NotificationPreferencesSettings({
  organizationId,
}: {
  organizationId: string
}) {
  const { t } = useTranslation(["notifications", "common"])
  const userId = useAuthenticatedSession()!.user.id
  const locale = useUiLocale()
  const id = useId()
  const client = useQueryClient()
  const prefix = [
    ...organizationKeys.scope(organizationId),
    "notifications",
    userId,
    "preferences",
  ] as const
  const key = [...prefix, locale] as const
  const preferences = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) =>
      NotificationPreferencesSchema.parse(
        (await getNotificationPreferences(organizationId, { signal })).data
      ),
  })
  const mutation = useMutation({
    retry: false,
    mutationFn: async (
      input: ReturnType<typeof NotificationPreferencesSchema.parse>
    ) =>
      NotificationPreferencesSchema.parse(
        (await updateNotificationPreferences(organizationId, input)).data
      ),
  })
  const [saved, setSaved] = useState(false)
  const form = useForm({
    defaultValues: { emailEnabled: false },
    validators: { onSubmit: NotificationPreferencesSchema },
    onSubmit: async ({ value, formApi }) => {
      setSaved(false)
      try {
        const result = await mutation.mutateAsync(value)
        // 不同语言的查询持有同一个偏好事实；旧读取不能覆盖已确认的保存结果。
        await client.cancelQueries({ queryKey: prefix })
        client.setQueriesData({ queryKey: prefix }, result)
        formApi.reset(result)
        setSaved(true)
      } catch {
        // Mutation 持有错误事实，操作区显示它，失败不会改写当前草稿。
        return
      }
    },
  })
  useEffect(() => {
    if (preferences.data && !form.state.isDirty) form.reset(preferences.data)
  }, [preferences.data, form, form.state.isDirty])
  if (preferences.isPending) return <LoadingState />
  if (preferences.isError)
    return (
      <ErrorState
        message={preferences.error.message}
        onRetry={() => void preferences.refetch()}
      />
    )
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-xl border p-4"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {t("preferencesTitle")}
      </h2>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <form
            aria-busy={pending}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
          >
            <fieldset disabled={pending} className="space-y-4">
              <form.Field name="emailEnabled">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field orientation="horizontal" data-invalid={invalid}>
                      <Checkbox
                        id={`${id}-email`}
                        checked={field.state.value}
                        disabled={pending}
                        onCheckedChange={(value) => {
                          setSaved(false)
                          field.handleChange(value)
                        }}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      />
                      <div>
                        <FieldLabel htmlFor={`${id}-email`}>
                          {t("emailResults")}
                        </FieldLabel>
                        <FieldDescription>{t("emailHint")}</FieldDescription>
                      </div>
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              {mutation.error && (
                <p role="alert" className="text-sm text-destructive">
                  {mutation.error.message}
                </p>
              )}
              {saved && <p role="status">{t("preferencesSaved")}</p>}
              <Button type="submit">
                {pending ? t("common:loading") : t("savePreferences")}
              </Button>
            </fieldset>
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}
