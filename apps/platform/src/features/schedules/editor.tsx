import { useId } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { useMutation } from "@tanstack/react-query"
import {
  CreatePlatformScheduleSchema,
  type CreatePlatformSchedule,
} from "@workspace/contracts/platform-schedules"
import { FormDialog } from "@workspace/admin"
import { Input } from "@workspace/ui/components/input"
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
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

export function ScheduleEditor({
  initial,
  editing,
  onClose,
  onSave,
}: {
  initial: CreatePlatformSchedule
  editing: boolean
  onClose: () => void
  onSave: (value: CreatePlatformSchedule) => Promise<void>
}) {
  const { t } = useTranslation(["monitor", "common"])
  const id = useId()
  const save = useMutation({ mutationFn: onSave, onSuccess: onClose })
  usePlatformAccessFailure(save.error)
  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: CreatePlatformScheduleSchema },
    onSubmit: async ({ value }) => {
      try {
        await save.mutateAsync(value)
      } catch {
        /* 保留字段与 mutation 错误供修正后重试。 */
      }
    },
  })
  const statuses = [
    { value: "enabled" as const, label: t("monitor:scheduleEnabled") },
    { value: "disabled" as const, label: t("monitor:scheduleDisabled") },
  ]
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <FormDialog
          open
          onOpenChange={(open) => !open && onClose()}
          title={
            editing ? t("monitor:editSchedule") : t("monitor:createSchedule")
          }
          description={t("monitor:scheduleEditorHint")}
          pending={pending || save.isPending}
          error={save.error?.message}
          onSubmit={() => void form.handleSubmit()}
          submitLabel={t("common:save")}
        >
          <FieldGroup className="gap-4">
            <form.Field name="name">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${id}-name`}>
                      {t("monitor:scheduleName")}
                    </FieldLabel>
                    <Input
                      id={`${id}-name`}
                      autoComplete="off"
                      required
                      maxLength={100}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={invalid}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="type">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${id}-type`}>
                      {t("monitor:scheduleType")}
                    </FieldLabel>
                    <Input
                      id={`${id}-type`}
                      readOnly
                      value={t("monitor:healthCheckType")}
                      onBlur={field.handleBlur}
                      aria-invalid={invalid}
                    />
                    <FieldDescription>
                      {t("monitor:healthCheckHint")}
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="cron">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${id}-cron`}>
                      {t("monitor:cron")}
                    </FieldLabel>
                    <Input
                      id={`${id}-cron`}
                      dir="ltr"
                      className="font-mono"
                      autoComplete="off"
                      required
                      minLength={9}
                      maxLength={120}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={invalid}
                      aria-describedby={`${id}-cron-hint`}
                    />
                    <FieldDescription id={`${id}-cron-hint`}>
                      {t("monitor:cronHint")}
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="timeZone">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${id}-zone`}>
                      {t("monitor:timeZone")}
                    </FieldLabel>
                    <Input
                      id={`${id}-zone`}
                      dir="ltr"
                      autoComplete="off"
                      required
                      maxLength={100}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      aria-invalid={invalid}
                      aria-describedby={`${id}-zone-hint`}
                    />
                    <FieldDescription id={`${id}-zone-hint`}>
                      {t("monitor:timeZoneHint")}
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <form.Field name="status">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor={`${id}-status`}>
                      {t("monitor:scheduleStatus")}
                    </FieldLabel>
                    <Select
                      value={field.state.value}
                      items={statuses}
                      onValueChange={(value) =>
                        value && field.handleChange(value)
                      }
                    >
                      <SelectTrigger
                        id={`${id}-status`}
                        onBlur={field.handleBlur}
                        aria-invalid={invalid}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statuses.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
          </FieldGroup>
        </FormDialog>
      )}
    </form.Subscribe>
  )
}
