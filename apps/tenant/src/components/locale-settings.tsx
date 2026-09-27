import { useEffect, useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
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
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const preferences = useQuery(getMyPreferencesOptions())
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
    defaultValues: { preferredLocale: null as "zh-CN" | "en-US" | "ar" | null },
    validators: { onSubmit: personalLocaleSchema },
    onSubmit: async ({ value, formApi }) => {
      if (!preferences.data) return
      setSubmitError(undefined)
      setSaved(false)
      if (activeOrganization.isPending) return
      if (value.preferredLocale === null && activeOrganization.isError) {
        setSubmitError(t("localeRefreshError"))
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
          void queryClient.invalidateQueries({
            queryKey: localeSettingsKeys.personal(),
          })
        } else {
          setSubmitError(t("saveError"))
        }
        return
      }

      const organizationId = activeOrganization.data
      let nextLocale = value.preferredLocale ?? "zh-CN"
      let nextSource = value.preferredLocale ? "user" : "platform"
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
          queryClient.setQueryData(localeSettingsKeys.personal(), result)
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
      queryClient.setQueryData(localeSettingsKeys.personal(), {
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
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-6"
        aria-busy={form.state.isSubmitting}
      >
        <fieldset disabled={form.state.isSubmitting} className="contents">
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
                      onBlur={field.handleBlur}
                      onChange={(value) =>
                        field.handleChange(
                          value === null || value === "__inherit__"
                            ? null
                            : SupportedLocaleSchema.parse(value)
                        )
                      }
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
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
          <Button type="submit" disabled={form.state.isSubmitting}>
            {form.state.isSubmitting ? t("saving") : t("save")}
          </Button>
        </fieldset>
      </form>
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
    defaultValues: { defaultLocale: null as "zh-CN" | "en-US" | "ar" | null },
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
          void queryClient.invalidateQueries({
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
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        className="space-y-6"
        aria-busy={form.state.isSubmitting}
      >
        <fieldset
          disabled={form.state.isSubmitting || !canUpdate}
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
                    <FieldDescription>{t("followPlatform")}</FieldDescription>
                    <LocaleSelect
                      id={`${id}-locale`}
                      value={field.state.value ?? "__inherit__"}
                      inheritLabel={t("followPlatform")}
                      invalid={invalid}
                      disabled={!canUpdate}
                      onBlur={field.handleBlur}
                      onChange={(value) =>
                        field.handleChange(
                          value === null || value === "__inherit__"
                            ? null
                            : SupportedLocaleSchema.parse(value)
                        )
                      }
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
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
            <Button type="submit" disabled={form.state.isSubmitting}>
              {form.state.isSubmitting ? t("saving") : t("save")}
            </Button>
          )}
        </fieldset>
      </form>
    </section>
  )
}
