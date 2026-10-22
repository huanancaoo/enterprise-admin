import { useId } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { useTranslation } from "react-i18next"
import { SearchIcon } from "lucide-react"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Button } from "@workspace/ui/components/button"

const schema = z.object({ query: z.string() })

export function FileSearch({
  value,
  pending,
  onSearch,
}: {
  value: string
  pending: boolean
  onSearch: (value: string) => void
}) {
  const { t } = useTranslation(["files", "common"])
  const id = useId()
  const form = useForm({
    defaultValues: { query: value },
    validators: { onSubmit: schema },
    onSubmit: ({ value }) => onSearch(value.query.trim()),
  })
  return (
    <form
      className="min-w-0 flex-1 sm:max-w-sm"
      role="search"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="query">
        {(field) => (
          <Field>
            <FieldLabel className="sr-only" htmlFor={id}>
              {t("files:searchPlaceholder")}
            </FieldLabel>
            <InputGroup className="bg-muted/30">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                id={id}
                value={field.state.value}
                placeholder={t("files:searchPlaceholder")}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                onKeyDown={(event) => {
                  // 输入法确认候选词时不能同时发起文件搜索。
                  if (event.key === "Enter" && event.nativeEvent.isComposing)
                    event.preventDefault()
                }}
              />
              <InputGroupAddon align="inline-end">
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  aria-label={t("common:tableSearch")}
                >
                  <SearchIcon className="size-4" />
                </Button>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        )}
      </form.Field>
    </form>
  )
}
