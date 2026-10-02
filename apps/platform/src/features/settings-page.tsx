import { useEffect, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouteContext } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  ApiClientError,
  getPlatformSettings,
  updatePlatformSettings,
  localeSettingsKeys,
} from "@workspace/api-client"
import {
  PlatformSettingsSchema,
  PlatformSettingsUpdateResultSchema,
  UpdatePlatformSettingsSchema,
  type PlatformSettings,
} from "@workspace/contracts"
import { ErrorState, LoadingState } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { localeMeta } from "@workspace/i18n"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
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
import { authClient } from "../lib/auth-client"

const formSchema = UpdatePlatformSettingsSchema.omit({ expectedVersion: true })

export function PlatformSettingsPage() {
  const { t } = useTranslation(["organization", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { refetch: refetchSession } = authClient.useSession()
  const [saved, setSaved] = useState(false)
  const [mutationError, setMutationError] = useState<unknown>()
  const queryKey = ["platform", session.user.id, "settings"] as const
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      PlatformSettingsSchema.parse(
        (await getPlatformSettings({ signal })).data
      ),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const error = mutationError ?? query.error
  useEffect(() => {
    if (
      !(error instanceof ApiClientError) ||
      ![401, 403].includes(error.status)
    )
      return
    void (async () => {
      await queryClient.cancelQueries({
        queryKey: ["platform", session.user.id],
      })
      queryClient.removeQueries({ queryKey: ["platform", session.user.id] })
      if (error.status === 401) {
        await refetchSession()
        await navigate({ to: "/login" })
      } else if (error.body.code === "PLATFORM_MFA_REQUIRED")
        await navigate({ to: "/platform/mfa", search: { challenge: false } })
      else await navigate({ to: "/platform/access-denied" })
    })()
  }, [error, navigate, queryClient, refetchSession, session.user.id])
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t("organization:platformSettings")}
        </h1>
        <p className="text-muted-foreground">
          {t("organization:platformSettingsDescription")}
        </p>
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="grid gap-4 rounded-xl border p-6 sm:grid-cols-2 [&_dd]:break-words [&>div]:min-w-0">
            <div>
              <dt className="text-sm text-muted-foreground">
                {t("organization:platformDefaultLocale")}
              </dt>
              <dd>{localeMeta[query.data.platformDefaultLocale].label}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                {t("organization:platformSupportedLocales")}
              </dt>
              <dd>
                {query.data.supportedLocales
                  .map((locale) => localeMeta[locale].label)
                  .join(" · ")}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                {t("organization:platformDeploymentEnvironment")}
              </dt>
              <dd>
                <bdi>{query.data.environment}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                {t("organization:platformApplicationVersion")}
              </dt>
              <dd>
                <bdi>{query.data.applicationVersion}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">
                {t("organization:platformSmtpConfiguration")}
              </dt>
              <dd>
                {query.data.smtpConfigured
                  ? t("organization:platformConfigured")
                  : t("organization:platformNotConfigured")}
              </dd>
              <dd className="text-sm text-muted-foreground">
                {t("organization:platformSmtpConfigurationHint")}
              </dd>
            </div>
          </dl>
          {saved && (
            <p role="status">{t("organization:platformSettingsSaved")}</p>
          )}
          {platformAccess.role === "platform_admin" ? (
            <SettingsForm
              key={query.data.version}
              setting={query.data}
              onReload={() => query.refetch().then(() => undefined)}
              onError={(error) => {
                setMutationError(error)
                setSaved(false)
              }}
              onSave={async (result) => {
                setSaved(true)
                queryClient.setQueryData<PlatformSettings>(queryKey, {
                  ...query.data,
                  platformDefaultLocale: result.platformDefaultLocale,
                  version: result.version,
                })
                await queryClient.invalidateQueries({
                  queryKey: localeSettingsKeys.personal(session.user.id),
                })
              }}
            />
          ) : (
            <p>{t("organization:platformSettingsReadOnly")}</p>
          )}
        </>
      )}
    </div>
  )
}

function SettingsForm({
  setting,
  onSave,
  onReload,
  onError,
}: {
  setting: PlatformSettings
  onSave: (
    result: z.infer<typeof PlatformSettingsUpdateResultSchema>
  ) => Promise<void>
  onReload: () => Promise<void>
  onError: (error: unknown) => void
}) {
  const { t } = useTranslation(["organization", "common", "errors"])
  const [error, setError] = useState<unknown>()
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const form = useForm({
    defaultValues: {
      platformDefaultLocale: setting.platformDefaultLocale,
      reason: "",
    },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = formSchema.safeParse(value)
        if (parsed.success) return undefined
        return {
          fields: Object.fromEntries(
            parsed.error.issues.map((issue) => [
              issue.path[0],
              { message: t("organization:platformReasonInvalid") },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      onError(undefined)
      const data = {
        ...formSchema.parse(value),
        expectedVersion: setting.version,
      }
      const body = JSON.stringify(data)
      // 请求结果未知时用相同键重试；用户改变输入即构成另一项明确操作。
      if (attempt.current?.body !== body)
        attempt.current = { body, key: crypto.randomUUID() }
      try {
        const result = PlatformSettingsUpdateResultSchema.parse(
          (
            await updatePlatformSettings(data, {
              "idempotency-key": attempt.current.key,
            })
          ).data
        )
        await onSave(result)
        form.reset({
          platformDefaultLocale: result.platformDefaultLocale,
          reason: "",
        })
        attempt.current = null
      } catch (failure) {
        setError(failure)
        onError(failure)
      }
    },
  })
  const stale =
    error instanceof ApiClientError && error.body.code === "VERSION_CONFLICT"
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(busy) => (
        <form
          className="max-w-xl space-y-4 rounded-xl border p-6"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <FieldGroup>
              <form.Field name="platformDefaultLocale">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="platform-settings-locale">
                        {t("organization:platformDefaultLocale")}
                      </FieldLabel>
                      <Select
                        items={setting.supportedLocales.map((locale) => ({
                          value: locale,
                          label: localeMeta[locale].label,
                        }))}
                        value={field.state.value}
                        onValueChange={(value) => {
                          if (value) field.handleChange(value)
                        }}
                      >
                        <SelectTrigger
                          id="platform-settings-locale"
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {setting.supportedLocales.map((locale) => (
                            <SelectItem key={locale} value={locale}>
                              {localeMeta[locale].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>
                        {t("organization:platformSettingsInheritance")}
                      </FieldDescription>
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="reason">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="platform-settings-reason">
                        {t("organization:platformSettingsReason")}
                      </FieldLabel>
                      <Textarea
                        id="platform-settings-reason"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                        required
                        minLength={10}
                        maxLength={500}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
            {Boolean(error) && (
              <p role="alert" className="text-sm text-destructive">
                {error instanceof ApiClientError
                  ? t(`errors:${error.body.code}`)
                  : t("errors:INTERNAL_ERROR")}
              </p>
            )}
            {stale && (
              <Button
                variant="secondary"
                type="button"
                onClick={() => void onReload()}
              >
                {t("organization:platformSettingsReload")}
              </Button>
            )}
            <Button variant="secondary" type="submit" disabled={busy}>
              {busy ? t("common:submitting") : t("common:save")}
            </Button>
          </fieldset>
        </form>
      )}
    </form.Subscribe>
  )
}
