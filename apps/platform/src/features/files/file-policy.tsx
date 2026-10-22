import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  getPlatformFilePolicy,
  updatePlatformFilePolicy,
} from "@workspace/api-client"
import {
  FileUsageResponseSchema,
  UpdatePlatformFilePolicySchema,
  type FileUsageResponse,
} from "@workspace/contracts"
import { ErrorState, LoadingState } from "@workspace/admin"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Button } from "@workspace/ui/components/button"
import { useFileScope, fileRequestErrorMessage } from "./queries"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
const policySchema = UpdatePlatformFilePolicySchema.omit({
  expectedRevision: true,
})
export function PlatformFilePolicy() {
  const scope = useFileScope(),
    client = useQueryClient(),
    { t } = useTranslation(["files", "common"])
  const [saved, setSaved] = useState(false)
  const key = ["platform", scope.userId, "file-policy"]
  const query = useQuery({
    queryKey: key,
    retry: false,
    queryFn: async ({ signal }) =>
      FileUsageResponseSchema.parse(
        (await getPlatformFilePolicy({ signal })).data
      ),
  })
  usePlatformAccessFailure(query.error)
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-lg font-semibold">{t("files:platformPolicy")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("files:platformPolicyDescription")}
      </p>
      {saved && (
        <FieldDescription role="status">
          {t("files:policySaved")}
        </FieldDescription>
      )}
      {query.isError ? (
        <ErrorState
          message={fileRequestErrorMessage(
            query.error,
            t("common:operationFailed")
          )}
          onRetry={() => void query.refetch()}
        />
      ) : !query.data ? (
        <LoadingState />
      ) : (
        <PolicyForm
          key={query.data.policyRevision}
          policy={query.data}
          canEdit={scope.permissions.includes("platform.settings:update")}
          onSaved={(policy) => {
            setSaved(true)
            client.setQueryData(key, policy)
            void client.invalidateQueries({ queryKey: scope.key })
          }}
          onReload={() => void query.refetch()}
        />
      )}
    </section>
  )
}
function PolicyForm({
  policy,
  canEdit,
  onSaved,
  onReload,
}: {
  policy: FileUsageResponse
  canEdit: boolean
  onSaved: (policy: FileUsageResponse) => void
  onReload: () => void
}) {
  const { t } = useTranslation(["files", "common"]),
    id = useId(),
    [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: {
      quotaBytes: policy.quotaBytes,
      trashDays: policy.trashDays,
      historyDays: policy.historyDays,
    },
    validators: { onSubmit: policySchema },
    onSubmit: async ({ value }) => {
      if (!canEdit) return
      setError(undefined)
      try {
        const result = FileUsageResponseSchema.parse(
          (
            await updatePlatformFilePolicy({
              ...policySchema.parse(value),
              expectedRevision: policy.policyRevision,
            })
          ).data
        )
        onSaved(result)
      } catch (cause) {
        setError(cause)
      }
    },
  })
  const fields = [
    { name: "quotaBytes", label: t("files:quotaBytesLabel"), min: 0 },
    { name: "trashDays", label: t("files:trashDays"), min: 1 },
    { name: "historyDays", label: t("files:historyDays"), min: 1 },
  ] as const
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(busy) => (
        <form
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          className="space-y-4"
        >
          <fieldset disabled={busy || !canEdit}>
            <FieldGroup>
              {fields.map(({ name, label, min }) => (
                <form.Field key={name} name={name}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-${name}`}>
                          {label}
                        </FieldLabel>
                        <Input
                          id={`${id}-${name}`}
                          type="number"
                          min={min}
                          step={1}
                          required
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(event) =>
                            field.handleChange(event.target.valueAsNumber)
                          }
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
            </FieldGroup>
          </fieldset>
          {Boolean(error) && (
            <>
              <p role="alert" className="text-destructive">
                {fileRequestErrorMessage(error, t("common:operationFailed"))}
              </p>
              <Button type="button" variant="outline" onClick={onReload}>
                {t("files:reloadPolicy")}
              </Button>
            </>
          )}
          {canEdit && (
            <Button type="submit" disabled={busy}>
              {t(busy ? "common:submitting" : "common:save")}
            </Button>
          )}
        </form>
      )}
    </form.Subscribe>
  )
}
