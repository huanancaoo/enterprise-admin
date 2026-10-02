import { useEffect, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouteContext } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { ApiClientError, apiClient } from "@workspace/api-client"
import {
  PlatformStoragePolicySchema,
  PlatformStoragePolicyUpdateResultSchema,
  UpdatePlatformStoragePolicySchema,
  type PlatformStoragePolicy,
  type PlatformStoragePolicyUpdateResult,
} from "@workspace/contracts"
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { authClient } from "../../lib/auth-client"

const gib = 2 ** 30
const integerDays = z
  .string()
  .min(1)
  .refine((value) => {
    const days = Number(value)
    return Number.isInteger(days) && days >= 1 && days <= 2147483647
  })
const formSchema = z.strictObject({
  quotaGiB: z
    .string()
    .min(1)
    .refine((value) => {
      const bytes = Number(value) * gib
      return value.trim() !== "" && Number.isSafeInteger(bytes) && bytes >= 0
    }),
  trashDays: integerDays,
  historyDays: integerDays,
  reason: UpdatePlatformStoragePolicySchema.shape.reason,
})

export function OrganizationStoragePolicy({
  organizationId,
}: {
  organizationId: string
}) {
  const { t } = useTranslation(["organization", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { refetch: refetchSession } = authClient.useSession()
  const format = createFormatter(useUiLocale())
  const [saved, setSaved] = useState(false)
  const [mutationError, setMutationError] = useState<unknown>()
  const queryKey = [
    "platform",
    session.user.id,
    "storage-policy",
    organizationId,
  ] as const
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      PlatformStoragePolicySchema.parse(
        (
          await apiClient<{ data: unknown }>(
            `/api/v1/platform/organizations/${organizationId}/storage-policy`,
            { signal }
          )
        ).data
      ),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const error = mutationError ?? query.error
  const accessFailure =
    error instanceof ApiClientError && [401, 403].includes(error.status)
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
      } else if (error.body.code === "PLATFORM_MFA_REQUIRED") {
        await navigate({ to: "/platform/mfa", search: { challenge: false } })
      } else await navigate({ to: "/platform/access-denied" })
    })()
  }, [error, navigate, queryClient, refetchSession, session.user.id])
  return (
    <section className="space-y-4" aria-labelledby="storage-policy-title">
      <h2 id="storage-policy-title" className="text-lg font-semibold">
        {t("organization:storagePolicyTitle")}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t("organization:storagePolicyDescription")}
      </p>
      {accessFailure ? (
        <PermissionDeniedState />
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
            {(
              [
                [
                  t("organization:storagePolicyQuotaSummary"),
                  query.data.quotaBytes,
                ],
                [t("organization:storagePolicyUsed"), query.data.usedBytes],
                [
                  t("organization:storagePolicyReserved"),
                  query.data.reservedBytes,
                ],
                [
                  t("organization:storagePolicyTransient"),
                  query.data.transientBytes,
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd>
                  <bdi>{format.number(value)}</bdi>
                </dd>
              </div>
            ))}
            <div>
              <dt>{t("organization:storagePolicyTrashDays")}</dt>
              <dd>{format.number(query.data.trashDays)}</dd>
            </div>
            <div>
              <dt>{t("organization:storagePolicyHistoryDays")}</dt>
              <dd>{format.number(query.data.historyDays)}</dd>
            </div>
          </dl>
          {query.data.overQuota && (
            <p role="status">{t("organization:storagePolicyOverQuota")}</p>
          )}
          {saved && <p role="status">{t("organization:storagePolicySaved")}</p>}
          {platformAccess.role === "platform_admin" ? (
            <StoragePolicyForm
              key={query.data.version}
              policy={query.data}
              onReload={() =>
                query.refetch().then(() => {
                  setSaved(false)
                  setMutationError(undefined)
                })
              }
              onError={(failure) => {
                setMutationError(failure)
                setSaved(false)
              }}
              onSave={(result) => {
                queryClient.setQueryData<PlatformStoragePolicy>(
                  queryKey,
                  result
                )
                setSaved(true)
              }}
            />
          ) : (
            <p>{t("organization:storagePolicyReadOnly")}</p>
          )}
        </>
      )}
    </section>
  )
}

function StoragePolicyForm({
  policy,
  onReload,
  onError,
  onSave,
}: {
  policy: PlatformStoragePolicy
  onReload: () => Promise<void>
  onError: (failure: unknown) => void
  onSave: (result: PlatformStoragePolicyUpdateResult) => void
}) {
  const { t } = useTranslation(["organization", "common", "errors"])
  const [error, setError] = useState<unknown>()
  const attempt = useRef<{ body: string; key: string } | null>(null)
  const form = useForm({
    defaultValues: {
      quotaGiB: String(policy.quotaBytes / gib),
      trashDays: String(policy.trashDays),
      historyDays: String(policy.historyDays),
      reason: "",
    },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = formSchema.safeParse(value)
        if (parsed.success) return undefined
        const messages = {
          quotaGiB: t("organization:storagePolicyInvalidQuota"),
          trashDays: t("organization:storagePolicyInvalidDays"),
          historyDays: t("organization:storagePolicyInvalidDays"),
          reason: t("organization:platformReasonInvalid"),
        }
        return {
          fields: Object.fromEntries(
            parsed.error.issues.map((issue) => [
              issue.path[0],
              { message: messages[issue.path[0] as keyof typeof messages] },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      onError(undefined)
      const parsed = formSchema.parse(value)
      const data = UpdatePlatformStoragePolicySchema.parse({
        quotaBytes: Number(parsed.quotaGiB) * gib,
        trashDays: Number(parsed.trashDays),
        historyDays: Number(parsed.historyDays),
        reason: parsed.reason,
        expectedVersion: policy.version,
      })
      const body = JSON.stringify(data)
      // 相同草稿重试沿用原键，未知响应不能生成第二次业务操作。
      if (attempt.current?.body !== body)
        attempt.current = { body, key: crypto.randomUUID() }
      try {
        const result = PlatformStoragePolicyUpdateResultSchema.parse(
          (
            await apiClient<{ data: unknown }>(
              `/api/v1/platform/organizations/${policy.organizationId}/storage-policy`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "idempotency-key": attempt.current.key,
                },
                body,
              }
            )
          ).data
        )
        onSave(result)
        form.reset({
          quotaGiB: String(result.quotaBytes / gib),
          trashDays: String(result.trashDays),
          historyDays: String(result.historyDays),
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
  const inputs = [
    {
      name: "quotaGiB",
      label: t("organization:storagePolicyQuotaGiB"),
      min: 0,
      max: Number.MAX_SAFE_INTEGER / gib,
      step: "any",
    },
    {
      name: "trashDays",
      label: t("organization:storagePolicyTrashDays"),
      min: 1,
      max: 2147483647,
      step: "1",
    },
    {
      name: "historyDays",
      label: t("organization:storagePolicyHistoryDays"),
      min: 1,
      max: 2147483647,
      step: "1",
    },
  ] as const
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
              {inputs.map((item) => (
                <form.Field key={item.name} name={item.name}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`storage-policy-${item.name}`}>
                          {item.label}
                        </FieldLabel>
                        <Input
                          id={`storage-policy-${item.name}`}
                          className="max-w-xs"
                          name={field.name}
                          type="number"
                          min={item.min}
                          max={item.max}
                          step={item.step}
                          required
                          value={field.state.value}
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
              ))}
              <form.Field name="reason">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="storage-policy-reason">
                        {t("organization:platformSettingsReason")}
                      </FieldLabel>
                      <Textarea
                        id="storage-policy-reason"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        required
                        minLength={10}
                        maxLength={500}
                        aria-invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
            <p className="text-sm text-muted-foreground">
              {t("organization:storagePolicyFutureOnly")}
            </p>
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
                {t("organization:storagePolicyReload")}
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? t("common:submitting") : t("common:save")}
            </Button>
          </fieldset>
        </form>
      )}
    </form.Subscribe>
  )
}
