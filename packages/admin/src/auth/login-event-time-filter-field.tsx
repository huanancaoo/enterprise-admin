import type { ComponentProps } from "react"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

export function LoginEventTimeFilterField({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
  errors,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  invalid: boolean
  errors: ComponentProps<typeof FieldError>["errors"]
}) {
  return (
    <Field data-invalid={invalid} className="w-full gap-1 sm:w-56">
      <FieldLabel className="text-xs text-muted-foreground" htmlFor={id}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
      />
      {invalid && <FieldError id={`${id}-error`} errors={errors} />}
    </Field>
  )
}
