import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { AuthPageShell } from "./auth-page-shell"
import { useWorkspaceAuthClient } from "./auth-client-context"
import { useAuthAction } from "./use-auth-action"
import { DeviceAccountSwitcher } from "./device-session-menu"

export function TotpChallengePage({ title }: { title: string }) {
  const { t } = useTranslation(["auth", "common"])
  const client = useWorkspaceAuthClient()
  const action = useAuthAction()
  const form = useForm({
    defaultValues: { code: "" },
    validators: {
      onSubmit: z.object({
        code: z.string().regex(/^\d{6}$/, t("auth:mfaCodeInvalid")),
      }),
    },
    onSubmit: async ({ value }) => {
      if (
        await action.run(() =>
          client.twoFactor.verifyTotp({ code: value.code, trustDevice: false })
        )
      ) {
        window.location.assign("/")
      }
    },
  })
  return (
    <AuthPageShell title={title}>
      <form
        className="space-y-6"
        aria-busy={action.pending}
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <fieldset disabled={action.pending}>
          <FieldGroup>
            <h1 className="text-center font-heading text-2xl font-semibold">
              {t("auth:mfaVerifyTitle")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("auth:mfaVerifyDescription")}
            </p>
            <form.Field name="code">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="auth-totp-code">
                      {t("auth:mfaCode")}
                    </FieldLabel>
                    <Input
                      id="auth-totp-code"
                      name={field.name}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                      required
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            {action.error && (
              <p role="alert" className="text-sm text-destructive">
                {action.error}
              </p>
            )}
            <Button type="submit">{t("auth:mfaVerifyButton")}</Button>
          </FieldGroup>
        </fieldset>
      </form>
      <div className="mt-6 text-center">
        <DeviceAccountSwitcher
          action={action}
          disabled={action.pending}
          onAddAccount={() => window.location.assign("/add-account")}
        />
      </div>
    </AuthPageShell>
  )
}
