import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { FormDialog } from "@workspace/admin"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { useTranslation } from "react-i18next"
import { z } from "zod"

function createExampleSchema(message: string) {
  return z.object({ name: z.string().trim().min(1, message) })
}

// 验证通用 FormDialog 的草稿生命周期，不调用尚未在 S7 交付的创建业务接口。
export function FormDialogExample({
  fail = false,
  initiallyOpen = false,
  busy = false,
  longTitle = false,
}: {
  fail?: boolean
  initiallyOpen?: boolean
  busy?: boolean
  longTitle?: boolean
}) {
  const { t } = useTranslation(["projects", "common", "validation"])
  const [open, setOpen] = useState(initiallyOpen)
  const [error, setError] = useState<string>()
  const form = useForm({
    defaultValues: { name: "" },
    validators: { onSubmit: createExampleSchema(t("validation:projectName")) },
    onSubmit: async ({ formApi }) => {
      setError(undefined)
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (fail) {
        setError(t("common:operationFailed"))
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
            title={
              longTitle ? t("projects:create").repeat(20) : t("projects:create")
            }
            description={t("projects:name")}
            onSubmit={() => void form.handleSubmit()}
            pending={pending || busy}
            error={error}
          >
            <FieldGroup>
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel htmlFor="example-project-name">
                        {t("projects:name")}
                      </FieldLabel>
                      <Input
                        id="example-project-name"
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
            </FieldGroup>
          </FormDialog>
        )}
      </form.Subscribe>
    </>
  )
}
