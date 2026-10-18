import { useId, useState, type ChangeEvent, type ComponentProps } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

export type CatalogValues = {
  key: string
  name: string
  label: string
  value: string
  remark: string
  status: string
  sort: number
}
export type CatalogField = "key" | "name" | "label" | "value" | "remark"
export type StatusOption = { value: string; label: string }

type CatalogFieldFeedback = {
  id: string
  invalid: boolean
  onBlur: () => void
  errors: ComponentProps<typeof FieldError>["errors"]
}

export function CatalogStatusField<TValue extends string>({
  id,
  value,
  statuses,
  onChange,
  onBlur,
  invalid,
  errors,
}: CatalogFieldFeedback & {
  value: TValue
  statuses: readonly { value: TValue; label: string }[]
  onChange: (value: TValue) => void
}) {
  const { t } = useTranslation("catalogs")
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{t("status")}</FieldLabel>
      <Select
        items={statuses}
        value={value}
        onValueChange={(next) => next !== null && onChange(next)}
      >
        <SelectTrigger
          id={id}
          onBlur={onBlur}
          aria-invalid={invalid}
          className="w-full"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {invalid && <FieldError errors={errors} />}
    </Field>
  )
}

export function CatalogSortField({
  id,
  value,
  onChange,
  onBlur,
  invalid,
  errors,
}: CatalogFieldFeedback & {
  value: number
  onChange: (value: number) => void
}) {
  const { t } = useTranslation("catalogs")
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{t("sort")}</FieldLabel>
      <Input
        id={id}
        type="number"
        min={0}
        max={2147483647}
        step={1}
        required
        value={Number.isNaN(value) ? "" : value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        aria-invalid={invalid}
      />
      {invalid && <FieldError errors={errors} />}
    </Field>
  )
}

function editorSchema(
  fields: readonly CatalogField[],
  invalid: string,
  allowEmptyValue: boolean
) {
  return z
    .object({
      key: z.string().trim().max(120),
      name: z.string().trim().max(200),
      label: z.string().trim().max(200),
      value: z.string().max(10000),
      remark: z.string().trim().max(1000),
      status: z.string().min(1, invalid),
      sort: z.number().int().min(0).max(2147483647),
    })
    .superRefine((value, context) => {
      for (const field of fields) {
        if (
          field !== "remark" &&
          !(field === "value" && allowEmptyValue) &&
          !value[field].trim()
        ) {
          context.addIssue({ code: "custom", path: [field], message: invalid })
        }
      }
      if (
        fields.includes("key") &&
        !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value.key)
      )
        context.addIssue({ code: "custom", path: ["key"], message: invalid })
      if (fields.includes("label") && value.value.length > 500)
        context.addIssue({ code: "custom", path: ["value"], message: invalid })
    })
}

export function CatalogEditorDialog({
  title,
  fields,
  initial,
  statuses,
  allowEmptyValue = false,
  onClose,
  onSave,
}: {
  title: string
  fields: readonly CatalogField[]
  initial: CatalogValues
  statuses: readonly StatusOption[]
  allowEmptyValue?: boolean
  onClose: () => void
  onSave: (value: CatalogValues) => Promise<void>
}) {
  const { t } = useTranslation(["catalogs", "common"])
  const id = useId()
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: initial,
    validators: {
      onSubmit: editorSchema(fields, t("catalogs:invalid"), allowEmptyValue),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        await onSave(value)
        onClose()
      } catch (failure) {
        setError(failure)
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{t("catalogs:editHint")}</DialogDescription>
            </DialogHeader>
            <form
              noValidate
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={pending} className="space-y-5">
                <FieldGroup className="gap-4">
                  {fields.map((name) => (
                    <form.Field key={name} name={name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        const controlProps = {
                          id: `${id}-${name}`,
                          name: field.name,
                          value: field.state.value,
                          onBlur: field.handleBlur,
                          onChange: (
                            event: ChangeEvent<
                              HTMLInputElement | HTMLTextAreaElement
                            >
                          ) => field.handleChange(event.target.value),
                          "aria-invalid": invalid,
                          required:
                            name !== "remark" &&
                            !(name === "value" && allowEmptyValue),
                          maxLength:
                            name === "remark"
                              ? 1000
                              : name === "value"
                                ? fields.includes("label")
                                  ? 500
                                  : 10000
                                : name === "key"
                                  ? 120
                                  : 200,
                        }
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={controlProps.id}>
                              {t(`catalogs:${name}`)}
                            </FieldLabel>
                            {name === "remark" || name === "value" ? (
                              <Textarea
                                {...controlProps}
                                rows={name === "value" ? 4 : 2}
                              />
                            ) : (
                              <Input {...controlProps} autoComplete="off" />
                            )}
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))}
                  <div className="grid grid-cols-2 gap-4">
                    <form.Field name="status">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <CatalogStatusField
                            id={`${id}-status`}
                            value={field.state.value}
                            statuses={statuses}
                            onChange={field.handleChange}
                            onBlur={field.handleBlur}
                            invalid={invalid}
                            errors={field.state.meta.errors}
                          />
                        )
                      }}
                    </form.Field>
                    <form.Field name="sort">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <CatalogSortField
                            id={`${id}-sort`}
                            value={field.state.value}
                            onChange={field.handleChange}
                            onBlur={field.handleBlur}
                            invalid={invalid}
                            errors={field.state.meta.errors}
                          />
                        )
                      }}
                    </form.Field>
                  </div>
                </FieldGroup>
                {error !== undefined && (
                  <p role="alert" className="text-sm text-destructive">
                    {error instanceof Error
                      ? error.message
                      : t("common:operationFailed")}
                  </p>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={onClose}>
                    {t("common:cancel")}
                  </Button>
                  <Button type="submit">
                    {pending ? t("common:submitting") : t("common:save")}
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

export function CatalogDeleteDialog({
  name,
  onClose,
  onDelete,
}: {
  name: string
  onClose: () => void
  onDelete: () => Promise<void>
}) {
  const { t } = useTranslation(["catalogs", "common"])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{t("catalogs:delete")}</DialogTitle>
          <DialogDescription>
            {t("catalogs:deleteHint", { name })}
          </DialogDescription>
        </DialogHeader>
        {error !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {error instanceof Error
              ? error.message
              : t("common:operationFailed")}
          </p>
        )}
        <DialogFooter>
          <Button disabled={pending} variant="outline" onClick={onClose}>
            {t("common:cancel")}
          </Button>
          <Button
            disabled={pending}
            variant="destructive"
            onClick={async () => {
              setPending(true)
              setError(undefined)
              try {
                await onDelete()
                onClose()
              } catch (failure) {
                setError(failure)
              } finally {
                setPending(false)
              }
            }}
          >
            {pending ? t("common:submitting") : t("catalogs:delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CatalogStatus({
  value,
  statuses,
}: {
  value: string
  statuses: readonly StatusOption[]
}) {
  return (
    <Badge variant={value === statuses[0]?.value ? "secondary" : "outline"}>
      {statuses.find((option) => option.value === value)?.label}
    </Badge>
  )
}
