"use client"

import * as React from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { useTranslation } from "react-i18next"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import type { Column, RowData } from "@tanstack/react-table"
import { cn } from "cn"
import { CirclePlusIcon, SearchIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  useDataTableContext,
  type DataTableFeatures,
  type DataTableFacetedFilterOption,
} from "../../hooks/use-data-table"
import { getColumnLabel } from "../../lib/data-table-columns"
import { DataTableViewOptions } from "./column-settings"
import { useDataTablePresentation } from "./presentation"

export function DataTableToolbar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="data-table-toolbar"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {/* 与搜索框保持同高，切换为选择操作时不改变表格的垂直位置。 */}
      <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </div>
      <DataTableViewOptions />
    </div>
  )
}

const searchSchema = z.object({ query: z.string() })

export function DataTableSearch({
  value,
  placeholder,
}: {
  value: string
  placeholder?: string
}) {
  const { t } = useTranslation("common")
  const table = useDataTableContext()
  const { isActionPending, status } = useDataTablePresentation()
  const id = React.useId()
  const pending = status === "loading" || status === "refreshing"
  const form = useForm({
    defaultValues: { query: value },
    validators: { onSubmit: searchSchema },
    onSubmit: ({ value }) => table.setGlobalFilter(value.query.trim()),
  })

  return (
    <form
      className="flex min-w-0 items-center gap-2"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="query">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={id} className="sr-only">
              {placeholder ?? t("search")}
            </FieldLabel>
            <InputGroup className="max-w-sm">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                id={id}
                value={field.state.value}
                placeholder={placeholder ?? t("search")}
                disabled={isActionPending}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                onKeyDown={(event) => {
                  // 中文等输入法的确认键只提交候选词，不提交列表查询。
                  if (event.key === "Enter" && event.nativeEvent.isComposing)
                    event.preventDefault()
                }}
              />
            </InputGroup>
          </Field>
        )}
      </form.Field>
      <Button
        type="submit"
        variant="outline"
        disabled={pending || isActionPending}
      >
        {t("tableSearch")}
      </Button>
    </form>
  )
}

export function DataTableFacetedFilter<TData extends RowData>({
  column,
  options,
}: {
  column: Column<DataTableFeatures, TData, unknown>
  options: readonly DataTableFacetedFilterOption[]
}) {
  const { t } = useTranslation("common")
  const title = getColumnLabel(column)
  const { isActionPending } = useDataTablePresentation()
  const table = useDataTableContext()
  const format = createFormatter(useUiLocale())
  const facetMode = column.columnDef.meta?.facetMode ?? "multiple"
  const filterValue = column.getFilterValue()
  const selectedValues =
    facetMode === "single"
      ? new Set(typeof filterValue === "string" ? [filterValue] : [])
      : new Set((filterValue as string[] | undefined) ?? [])
  // 服务端分页只持有当前页，不能把页内计数展示为筛选总数。
  const facets =
    table.options.manualFiltering || table.options.manualPagination
      ? undefined
      : column.getFacetedUniqueValues()

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={isActionPending}
            size="sm"
            className="h-auto min-h-8 flex-wrap border-dashed"
          />
        }
      >
        <CirclePlusIcon data-icon="inline-start" />
        {title}
        {options
          .filter((option) => selectedValues.has(option.value))
          .map((option) => (
            <Badge key={option.value} variant="secondary">
              {option.label}
            </Badge>
          ))}
      </PopoverTrigger>
      <PopoverContent
        className="w-56 gap-0 p-0"
        align="start"
        aria-label={t("filterColumn", { title: title })}
      >
        <Command>
          <CommandInput
            placeholder={title}
            aria-label={t("searchOptions", { title: title })}
          />
          <CommandList>
            <CommandEmpty>{t("emptyTitle")}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value)
                const count = facets?.get(option.value)
                const Icon = option.icon

                return (
                  <CommandItem
                    disabled={isActionPending}
                    key={option.value}
                    data-checked={isSelected}
                    onSelect={() => {
                      if (facetMode === "single") {
                        column.setFilterValue(
                          isSelected ? undefined : option.value
                        )
                        return
                      }
                      const next = new Set(selectedValues)
                      if (isSelected) {
                        next.delete(option.value)
                      } else {
                        next.add(option.value)
                      }
                      column.setFilterValue(
                        next.size > 0 ? Array.from(next) : undefined
                      )
                    }}
                  >
                    {Icon ? <Icon /> : null}
                    <span className="flex-1">{option.label}</span>
                    {count != null ? (
                      <span className="text-xs text-foreground tabular-nums">
                        {format.number(count)}
                      </span>
                    ) : null}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selectedValues.size > 0 ? (
              <CommandGroup>
                <CommandItem
                  disabled={isActionPending}
                  onSelect={() => column.setFilterValue(undefined)}
                >
                  {t("clearFilters")}
                </CommandItem>
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
