import { useEffect, useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { z } from "zod"
import {
  ApiClientError,
  getMyPreferencesOptions,
  getOrganizationSettingsOptions,
  getOrganizationAccess,
  getOrganizationAccessOptions,
  organizationKeys,
  localeSettingsKeys,
  updateMyPreferences,
  updateOrganizationSettings,
} from "@workspace/api-client"
import { SupportedLocaleSchema } from "@workspace/contracts"
import { localeMeta } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
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
import { authClient } from "@/lib/auth-client"
import { getOrganizationSettingsPermissionsOptions } from "@/query/organization-settings-permissions"

const personalLocaleSchema = z.object({
  preferredLocale: SupportedLocaleSchema.nullable(),
})
const organizationLocaleSchema = z.object({
  defaultLocale: SupportedLocaleSchema.nullable(),
})

function LocaleSelect({
  id,
  value,
  onChange,
  inheritLabel,
  invalid,
  onBlur,
  disabled = false,
}: {
  id: string
  value: string
  onChange: (value: string | null) => void
  inheritLabel: string
  invalid?: boolean
  onBlur?: () => void
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      items={{
        __inherit__: inheritLabel,
        ...Object.fromEntries(
          Object.entries(localeMeta).map(([locale, meta]) => [
            locale,
            meta.label,
          ])
        ),
      }}
      onValueChange={onChange}
    >
      <SelectTrigger
        id={id}
        onBlur={onBlur}
        aria-invalid={invalid}
        disabled={disabled}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__inherit__">{inheritLabel}</SelectItem>
        {Object.entries(localeMeta).map(([locale, meta]) => (
          <SelectItem key={locale} value={locale}>
            {meta.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PersonalLocaleSettingsRoute() {
  const { t, i18n } = useTranslation(["settings", "common"])
  const session = useAuthenticatedSession()!
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const personalPreferencesKey = localeSettingsKeys.personal(session.user.id)
  const preferences = useQuery(getMyPreferencesOptions(session.user.id))
  const activeOrganization = useQuery({
    queryKey: ["auth", "active-organization"],
    retry: false,
    queryFn: async () => {
      const result = await authClient.organization.getFullOrganization()
      if (result.error) throw new Error(result.error.message)
      return result.data?.id ?? null
    },
  })
  const activeAccess = useQuery({
    ...getOrganizationAccessOptions(activeOrganization.data ?? ""),
    enabled: Boolean(activeOrganization.data),
  })
  const id = useId()
  const [submitError, setSubmitError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const form = useForm({
    defaultValues: {
      preferredLocale: preferences.data?.data.preferredLocale ?? null,
    },
    validators: { onSubmit: personalLocaleSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!preferences.data) return
      setSubmitError(undefined)
      setSaved(false)
      if (
        value.preferredLocale === null &&
        (activeOrganization.isPending || activeOrganization.isError)
      ) {
        // 固定个人偏好不依赖组织目录；继承选择须先确认组织，失败时尚未保存。
        setSubmitError(t("saveError"))
        return
      }
      let result
      try {
        result = await updateMyPreferences({
          preferredLocale: value.preferredLocale,
          expectedVersion: preferences.data.data.version,
        })
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.body.code === "VERSION_CONFLICT"
        ) {
          setSubmitError(t("versionConflict"))
          // 版本读回前保持提交锁定，下一次写入必须使用最新版本并保留当前草稿。
          await queryClient.invalidateQueries({
            queryKey: personalPreferencesKey,
          })
        } else {
          setSubmitError(t("saveError"))
        }
        return
      }

      const organizationId = activeOrganization.data
      // 无组织时的继承来自服务端平台设置，不能固化为某一种默认语言。
      let nextLocale = result.data.effectiveLocale
      let nextSource = result.data.effectiveLocaleSource
      if (organizationId && value.preferredLocale === null) {
        try {
          await queryClient.invalidateQueries({
            queryKey: organizationKeys.access(organizationId),
          })
          const access = await getOrganizationAccess(organizationId)
          queryClient.setQueryData(
            organizationKeys.access(organizationId),
            access
          )
          nextLocale = access.data.effectiveLocale
          nextSource = access.data.effectiveLocaleSource
        } catch {
          queryClient.setQueryData(personalPreferencesKey, result)
          setSubmitError(t("localeRefreshError"))
          setSaved(true)
          return
        }
      } else if (organizationId && value.preferredLocale) {
        queryClient.setQueryData(
          organizationKeys.access(organizationId),
          (
            current:
              Awaited<ReturnType<typeof getOrganizationAccess>> | undefined
          ) =>
            current
              ? {
                  ...current,
                  data: {
                    ...current.data,
                    effectiveLocale: value.preferredLocale,
                    effectiveLocaleSource: "user" as const,
                  },
                }
              : current
        )
      }
      queryClient.setQueryData(personalPreferencesKey, {
        ...result,
        data: {
          ...result.data,
          effectiveLocale: nextLocale,
          effectiveLocaleSource: nextSource,
        },
      })
      await i18n.changeLanguage(nextLocale)
      formApi.reset({ preferredLocale: value.preferredLocale })
      setSaved(true)
    },
  })
  useEffect(() => {
    if (!preferences.data || form.state.isDirty) return
    form.reset({ preferredLocale: preferences.data.data.preferredLocale })
  }, [form, form.state.isDirty, preferences.data])
  if (preferences.isPending) return <p role="status">{t("common:loading")}</p>
  if (preferences.error) return <p role="alert">{t("loadError")}</p>
  const source = preferences.data.data.preferredLocale
    ? "user"
    : (activeAccess.data?.data.effectiveLocaleSource ?? "platform")
  const sourceTranslationKeys = {
    request: "sourceRequest",
    user: "sourceUser",
    organization: "sourceOrganization",
    platform: "sourcePlatform",
  } as const

  return (
    <section className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("personalSettings")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("personalDescription")}
        </p>
      </header>
      <div className="rounded-xl border p-4 text-sm">
        <dl className="space-y-2">
          <div className="flex gap-2">
            <dt className="font-medium">{t("effectiveLanguage")}</dt>
            <dd>{localeMeta[locale].label}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">{t("languageSource")}</dt>
            <dd className="text-muted-foreground">
              {t(
                sourceTranslationKeys[
                  source as keyof typeof sourceTranslationKeys
                ]
              )}
            </dd>
          </div>
        </dl>
      </div>
      {/* 提交锁定须订阅表单状态，字段的局部更新不会重绘整张表单。 */}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
            className="space-y-6"
            aria-busy={isSubmitting}
          >
            <fieldset disabled={isSubmitting} className="contents">
              <FieldGroup>
                <form.Field name="preferredLocale">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-locale`}>
                          {t("language")}
                        </FieldLabel>
                        <FieldDescription>
                          {t("followOrganization")}
                        </FieldDescription>
                        <LocaleSelect
                          id={`${id}-locale`}
                          value={field.state.value ?? "__inherit__"}
                          inheritLabel={t("followOrganization")}
                          invalid={invalid}
                          disabled={isSubmitting}
                          onBlur={field.handleBlur}
                          onChange={(value) =>
                            field.handleChange(
                              value === null || value === "__inherit__"
                                ? null
                                : SupportedLocaleSchema.parse(value)
                            )
                          }
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              )}
              {saved && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("saved")}
                </p>
              )}
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("saving") : t("save")}
              </Button>
            </fieldset>
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}

export function OrganizationLocaleSettingsRoute({
  organizationId,
}: {
  organizationId: string
}) {
  const { t } = useTranslation(["settings", "common"])
  const queryClient = useQueryClient()
  const settings = useQuery(getOrganizationSettingsOptions(organizationId))
  const permissions = useQuery(
    getOrganizationSettingsPermissionsOptions(organizationId)
  )
  const id = useId()
  const [submitError, setSubmitError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const form = useForm({
    // 权限查询完成后的重绘不能把已加载值清空，默认值须与服务端快照一致。
    defaultValues: { defaultLocale: settings.data?.data.defaultLocale ?? null },
    validators: { onSubmit: organizationLocaleSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!settings.data) return
      setSubmitError(undefined)
      setSaved(false)
      try {
        const result = await updateOrganizationSettings(organizationId, {
          defaultLocale: value.defaultLocale,
          expectedVersion: settings.data.data.version,
        })
        queryClient.setQueryData(
          localeSettingsKeys.organization(organizationId),
          result
        )
        await queryClient.invalidateQueries({
          queryKey: ["organizations", organizationId, "access"],
        })
        formApi.reset({ defaultLocale: value.defaultLocale })
        setSaved(true)
      } catch (error) {
        if (
          error instanceof ApiClientError &&
          error.body.code === "VERSION_CONFLICT"
        ) {
          setSubmitError(t("versionConflict"))
          // 错误提示不代表版本读回完成，不能提前开放下一次提交。
          await queryClient.invalidateQueries({
            queryKey: localeSettingsKeys.organization(organizationId),
          })
        } else if (error instanceof ApiClientError && error.status === 403) {
          setSubmitError(t("permissionDenied"))
        } else {
          setSubmitError(t("saveError"))
        }
      }
    },
  })
  useEffect(() => {
    if (!settings.data || form.state.isDirty) return
    form.reset({ defaultLocale: settings.data.data.defaultLocale })
  }, [form, form.state.isDirty, settings.data])

  if (settings.isPending || permissions.isPending)
    return <p role="status">{t("common:loading")}</p>
  if (settings.error || permissions.error) {
    const error = settings.error ?? permissions.error
    return (
      <p role="alert" className="text-sm text-destructive">
        {error instanceof ApiClientError && error.status === 403
          ? t("permissionDenied")
          : t("loadError")}
      </p>
    )
  }
  const canUpdate = permissions.data?.canUpdate === true
  return (
    <section className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("organizationSettings")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("organizationDescription")}
        </p>
        {!canUpdate && (
          <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
        )}
      </header>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
            className="space-y-6"
            aria-busy={isSubmitting}
          >
            <fieldset
              disabled={isSubmitting || !canUpdate}
              className="contents"
            >
              <FieldGroup>
                <form.Field name="defaultLocale">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-locale`}>
                          {t("language")}
                        </FieldLabel>
                        <FieldDescription>
                          {t("followPlatform")}
                        </FieldDescription>
                        <LocaleSelect
                          id={`${id}-locale`}
                          value={field.state.value ?? "__inherit__"}
                          inheritLabel={t("followPlatform")}
                          invalid={invalid}
                          disabled={isSubmitting || !canUpdate}
                          onBlur={field.handleBlur}
                          onChange={(value) =>
                            field.handleChange(
                              value === null || value === "__inherit__"
                                ? null
                                : SupportedLocaleSchema.parse(value)
                            )
                          }
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
              {submitError && (
                <p role="alert" className="text-sm text-destructive">
                  {submitError}
                </p>
              )}
              {saved && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("saved")}
                </p>
              )}
              {canUpdate && (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t("saving") : t("save")}
                </Button>
              )}
            </fieldset>
          </form>
        )}
      </form.Subscribe>
    </section>
  )
}
