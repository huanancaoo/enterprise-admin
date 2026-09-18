import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { FormDialog } from "@workspace/admin"
import { createProjectMutations } from "@workspace/api-client"
import { SupportedLocaleSchema } from "@workspace/contracts"
import { localeMeta } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

function createSchema(nameMessage: string) {
  return z.object({
    name: z.string().trim().min(1, nameMessage),
    description: z.string(),
    contentLocale: z.union([z.literal("default"), SupportedLocaleSchema]),
  })
}

export function ProjectCreate({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const locale = useUiLocale()
  const queryClient = useQueryClient()
  const mutations = createProjectMutations(queryClient, organizationId, locale)
  const id = useId()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
      contentLocale: "default" as "default" | "zh-CN" | "en-US" | "ar",
    },
    validators: { onSubmit: createSchema(t("validation:projectName")) },
    onSubmit: async ({ value, formApi }) => {
      setFailed(false)
      try {
        await mutations.create({
          name: value.name.trim(),
          description: value.description === "" ? null : value.description,
          ...(value.contentLocale === "default"
            ? {}
            : { contentLocale: value.contentLocale }),
        })
      } catch {
        setFailed(true)
        return
      }
      formApi.reset()
      setOpen(false)
    },
  })
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("projects:create")}</Button>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={open}
            onOpenChange={setOpen}
            title={t("projects:create")}
            description={t("projects:createDescription")}
            onSubmit={() => void form.handleSubmit()}
            pending={pending}
            error={failed ? t("common:operationFailed") : undefined}
            submitLabel={t("projects:create")}
          >
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${id}-name`}>
                        {t("projects:name")}
                      </FieldLabel>
                      <Input
                        id={`${id}-name`}
                        name={field.name}
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
              <form.Field name="description">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${id}-description`}>
                        {t("projects:description")}
                      </FieldLabel>
                      <Textarea
                        id={`${id}-description`}
                        name={field.name}
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
              <form.Field name="contentLocale">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor={`${id}-locale`}>
                        {t("projects:contentLocale")}
                      </FieldLabel>
                      <Select
                        value={field.state.value}
                        items={{
                          default: t("projects:organizationDefault"),
                          "zh-CN": localeMeta["zh-CN"].label,
                          "en-US": localeMeta["en-US"].label,
                          ar: localeMeta.ar.label,
                        }}
                        onValueChange={(value) =>
                          field.handleChange(
                            value === "default"
                              ? value
                              : SupportedLocaleSchema.parse(value)
                          )
                        }
                      >
                        <SelectTrigger
                          id={`${id}-locale`}
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">
                            {t("projects:organizationDefault")}
                          </SelectItem>
                          <SelectItem value="zh-CN">
                            {localeMeta["zh-CN"].label}
                          </SelectItem>
                          <SelectItem value="en-US">
                            {localeMeta["en-US"].label}
                          </SelectItem>
                          <SelectItem value="ar">
                            {localeMeta.ar.label}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
          </FormDialog>
        )}
      </form.Subscribe>
    </>
  )
}
