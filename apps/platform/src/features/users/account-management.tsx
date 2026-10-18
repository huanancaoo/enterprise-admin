import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  ApiClientError,
  createPlatformUser,
  updatePlatformUser,
  setPlatformUserStatus,
  requestPlatformUserPasswordReset,
} from "@workspace/api-client"
import {
  PlatformUserDetailSchema,
  type PlatformUserDetail,
} from "@workspace/contracts/platform"
import { PlatformUserMutationResultSchema } from "@workspace/contracts/identity-management"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
  FieldDescription,
} from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { usePlatformUserChanges } from "./user-queries"

export function CreatePlatformAccount({
  onCreated,
}: {
  onCreated: (user: PlatformUserDetail) => void
}) {
  const { t } = useTranslation(["identity", "validation", "common"])
  const id = useId()
  const changes = usePlatformUserChanges()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, t("validation:nameRequired")).max(200),
        email: z.email(t("validation:email")),
        password: z
          .string()
          .min(12, t("validation:passwordMin"))
          .max(128, t("validation:passwordMax")),
      }),
    },
    onSubmit: async ({ value, formApi }) => {
      setError(undefined)
      let user: PlatformUserDetail
      try {
        user = PlatformUserDetailSchema.parse(
          (await createPlatformUser(value)).data
        )
      } catch (failure) {
        setError(failure)
        return
      }
      await changes.created(user)
      formApi.reset()
      setOpen(false)
      onCreated(user)
    },
  })
  const fields = [
    {
      name: "name",
      label: "name",
      type: "text",
      autoComplete: "name",
      maxLength: 200,
    },
    {
      name: "email",
      label: "email",
      type: "email",
      autoComplete: "off",
      maxLength: 254,
    },
    {
      name: "password",
      label: "password",
      type: "password",
      autoComplete: "new-password",
      maxLength: 128,
    },
  ] as const
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!pending) {
              setOpen(next)
              setError(undefined)
              if (!next) form.reset()
            }
          }}
        >
          <DialogTrigger render={<Button size="sm" />}>
            {t("identity:createAccount")}
          </DialogTrigger>
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>{t("identity:createAccount")}</DialogTitle>
              <DialogDescription>
                {t("identity:createDescription")}
              </DialogDescription>
            </DialogHeader>
            <form
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={pending} className="space-y-5">
                <FieldGroup>
                  {fields.map((config) => (
                    <form.Field key={config.name} name={config.name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`${id}-${config.name}`}>
                              {t(`identity:${config.label}`)}
                            </FieldLabel>
                            <Input
                              id={`${id}-${config.name}`}
                              name={field.name}
                              type={config.type}
                              autoComplete={config.autoComplete}
                              required
                              maxLength={config.maxLength}
                              minLength={
                                config.name === "password" ? 12 : undefined
                              }
                              aria-invalid={invalid}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
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
                <FieldDescription>
                  {t("identity:verifiedAtCreation")}
                </FieldDescription>
                {error !== undefined && (
                  <p role="alert" className="text-sm text-destructive">
                    {error instanceof Error
                      ? error.message
                      : t("common:operationFailed")}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOpen(false)
                      form.reset()
                      setError(undefined)
                    }}
                  >
                    {t("common:cancel")}
                  </Button>
                  <Button type="submit">
                    {pending
                      ? t("identity:creating")
                      : t("identity:createAccount")}
                  </Button>
                </DialogFooter>
              </fieldset>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </form.Subscribe>
  )
}

export function PlatformAccountActions({
  user,
  permissions,
}: {
  user: PlatformUserDetail
  permissions: string[]
}) {
  const { t } = useTranslation(["identity", "validation", "common"])
  const id = useId()
  const changes = usePlatformUserChanges()
  const [action, setAction] = useState<"edit" | "status" | "reset" | null>(null)
  const [error, setError] = useState<unknown>()
  const [pending, setPending] = useState(false)
  const [resetRequested, setResetRequested] = useState(false)
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: { name: user.name },
    validators: {
      onSubmit: z.object({
        name: z.string().trim().min(1, t("validation:nameRequired")).max(200),
      }),
    },
    onSubmit: async ({ value }) => {
      await perform(async () => {
        const result = await updatePlatformUser(user.userId, {
          ...value,
          expectedVersion: user.version,
        })
        await changes.updated(
          PlatformUserMutationResultSchema.parse(result.data)
        )
      })
    },
  })
  async function perform(operation: () => Promise<void>) {
    setPending(true)
    setError(undefined)
    try {
      await operation()
      setAction(null)
    } catch (failure) {
      setError(failure)
    } finally {
      setPending(false)
    }
  }
  const statusLabel =
    user.status === "active"
      ? t("identity:suspendAccount")
      : t("identity:resumeAccount")
  const label =
    action === "edit"
      ? t("identity:editAccount")
      : action === "reset"
        ? t("identity:resetPassword")
        : statusLabel
  const description =
    action === "edit"
      ? t("identity:nameEditDescription")
      : action === "reset"
        ? t("identity:resetDescription")
        : user.status === "active"
          ? t("identity:suspendDescription")
          : t("identity:resumeDescription")
  function show(next: "edit" | "status" | "reset") {
    setError(undefined)
    setResetRequested(false)
    form.reset({ name: user.name })
    setAction(next)
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {permissions.includes("platform.user:update") && (
          <Button variant="outline" size="sm" onClick={() => show("edit")}>
            {t("identity:editAccount")}
          </Button>
        )}
        {permissions.includes("platform.user:suspend") && (
          <Button
            variant={user.status === "active" ? "destructive" : "outline"}
            size="sm"
            onClick={() => show("status")}
          >
            {statusLabel}
          </Button>
        )}
        {permissions.includes("platform.user:resetPassword") && (
          <Button variant="outline" size="sm" onClick={() => show("reset")}>
            {t("identity:resetPassword")}
          </Button>
        )}
      </div>
      {resetRequested && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("identity:resetRequested")}
        </p>
      )}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!pending && !open) setAction(null)
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault()
              if (action === "edit") {
                void form.handleSubmit()
                return
              }
              void perform(async () => {
                if (action === "reset") {
                  await requestPlatformUserPasswordReset(user.userId)
                  setResetRequested(true)
                } else {
                  const result = await setPlatformUserStatus(user.userId, {
                    status: user.status === "active" ? "suspended" : "active",
                    expectedVersion: user.version,
                  })
                  await changes.updated(
                    PlatformUserMutationResultSchema.parse(result.data)
                  )
                }
              })
            }}
          >
            <fieldset disabled={pending} className="space-y-5">
              {action === "edit" && (
                <form.Field name="name">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor={`${id}-name`}>
                          {t("identity:name")}
                        </FieldLabel>
                        <Input
                          id={`${id}-name`}
                          name={field.name}
                          required
                          maxLength={200}
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
              )}
              {error !== undefined && (
                <p role="alert" className="text-sm text-destructive">
                  {error instanceof ApiClientError &&
                  error.body.code === "VERSION_CONFLICT"
                    ? t("identity:conflict")
                    : error instanceof Error
                      ? error.message
                      : t("common:operationFailed")}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAction(null)}
                >
                  {t("common:cancel")}
                </Button>
                <Button
                  type="submit"
                  variant={
                    action === "status" && user.status === "active"
                      ? "destructive"
                      : "default"
                  }
                >
                  {pending
                    ? t("identity:saving")
                    : action === "edit"
                      ? t("identity:save")
                      : label}
                </Button>
              </DialogFooter>
            </fieldset>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
