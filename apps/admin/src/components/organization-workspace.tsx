import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { useAdminWorkspace } from "@/hooks/admin-workspace-context"
import { useForm } from "@tanstack/react-form"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import * as z from "zod"

const createOrganizationSchema = (
  t: TFunction<["organization", "common", "validation", "projects"]>
) =>
  z.object({
    name: z.string().trim().min(1, t("validation:organizationName")),
    slug: z.string().trim().min(1, t("validation:organizationSlug")),
  })

export function OrganizationWorkspace() {
  const { t } = useTranslation([
    "organization",
    "common",
    "validation",
    "projects",
  ])
  const { workspace, pending, createOrganization } = useAdminWorkspace()
  const form = useForm({
    defaultValues: { name: "", slug: "" },
    validators: {
      onSubmit: createOrganizationSchema(t),
    },
    onSubmit: async ({ value, formApi }) => {
      if (await createOrganization(value)) formApi.reset()
    },
  })

  const active = workspace.data?.active
  if (workspace.isPending)
    return <p role="status">{t("organization:loading")}</p>
  if (workspace.isError) {
    return (
      <div className="space-y-4">
        <p role="alert">{workspace.error.message}</p>
        <Button
          disabled={workspace.isFetching}
          onClick={() => void workspace.refetch()}
        >
          {t("common:retry")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* 活跃组织只记录工作区偏好；此处不据此开放任何租户业务操作。 */}
      {active && (
        <section className="space-y-2 rounded-xl border bg-muted/30 p-5">
          <h1 className="text-xl font-semibold wrap-break-word">
            {t("organization:current", { name: active.name })}
          </h1>
          <Link
            to="/app/projects/$organizationId"
            params={{ organizationId: active.id }}
            className="inline-flex text-sm font-medium underline underline-offset-4"
          >
            {t("projects:open")}
          </Link>
        </section>
      )}
      <section
        className="max-w-md space-y-4"
        aria-labelledby="create-organization-heading"
      >
        <h2 id="create-organization-heading" className="text-xl font-semibold">
          {t("organization:create")}
        </h2>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
          aria-busy={pending}
        >
          <fieldset disabled={pending}>
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="organization-name">
                        {t("organization:name")}
                      </FieldLabel>
                      <Input
                        id="organization-name"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={isInvalid}
                        required
                      />
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="slug">
                {(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel htmlFor="organization-slug">
                        {t("organization:slug")}
                      </FieldLabel>
                      <Input
                        id="organization-slug"
                        name={field.name}
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        aria-invalid={isInvalid}
                        required
                      />
                      <FieldDescription>
                        {t("organization:slugHint")}
                      </FieldDescription>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <Button type="submit">
                {pending ? t("common:submitting") : t("organization:create")}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      </section>
    </div>
  )
}
