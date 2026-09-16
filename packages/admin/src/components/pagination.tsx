"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { useUiLocale } from "@workspace/i18n/react"
import { createFormatter } from "@workspace/i18n"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import {
  Pagination as PaginationPrimitive,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@workspace/ui/components/pagination"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@workspace/ui/components/select"

const PAGE_SIZES = [10, 20, 30, 50, 100] as const

export function Pagination({
  pageSizes = PAGE_SIZES,
  disabled = false,
  isLoading = false,
  pageIndex,
  pageSize,
  rowCount,
  pageCount,
  onPageChange,
  onPageSizeChange,
}: {
  pageSizes?: readonly number[]
  disabled?: boolean
  isLoading?: boolean
  pageIndex: number
  pageSize: number
  rowCount: number
  pageCount: number
  onPageChange: (pageIndex: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const { t } = useTranslation("common")
  const format = createFormatter(useUiLocale())
  const pageSizeSelectId = React.useId()
  const pageSizeOptions = Object.fromEntries(
    pageSizes.map((size) => [String(size), format.number(size)])
  )
  const paginationItems = getPaginationItems(pageIndex, pageCount)

  return (
    <div
      data-slot="data-table-pagination"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="text-sm text-muted-foreground">
        {isLoading
          ? t("loading")
          : t("rows", { total: format.number(rowCount) })}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:gap-6 lg:gap-8">
        <Field orientation="horizontal" className="w-fit shrink-0">
          <FieldLabel htmlFor={pageSizeSelectId} className="whitespace-nowrap">
            {t("rowsPerPage")}
          </FieldLabel>
          <Select
            disabled={disabled}
            items={pageSizeOptions}
            value={String(pageSize)}
            onValueChange={(value) => {
              if (value !== null) onPageSizeChange(Number(value))
            }}
          >
            <SelectTrigger
              id={pageSizeSelectId}
              size="sm"
              className="w-20"
              aria-label={t("rowsPerPage")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start">
              <SelectGroup>
                {pageSizes.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {format.number(size)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <PaginationPrimitive
          aria-label={t("pagination")}
          className="mx-0 w-auto"
        >
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                aria-label={t("previous")}
                href="#"
                text=""
                disabled={disabled || pageIndex <= 0}
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(pageIndex - 1)
                }}
              />
            </PaginationItem>
            {paginationItems.map((item, index) =>
              item === "ellipsis" ? (
                <PaginationItem key={`ellipsis-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={item}>
                  <PaginationLink
                    href="#"
                    disabled={disabled}
                    isActive={item === pageIndex}
                    onClick={(event) => {
                      event.preventDefault()
                      onPageChange(item)
                    }}
                  >
                    {format.number(item + 1)}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                aria-label={t("next")}
                href="#"
                text=""
                disabled={disabled || pageIndex >= pageCount - 1}
                onClick={(event) => {
                  event.preventDefault()
                  onPageChange(pageIndex + 1)
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </PaginationPrimitive>
      </div>
    </div>
  )
}

function getPaginationItems(pageIndex: number, pageCount: number) {
  if (pageCount <= 0) return []
  if (pageCount <= 7)
    return Array.from({ length: pageCount }, (_, index) => index)

  const pages = new Set([
    0,
    pageCount - 1,
    pageIndex - 1,
    pageIndex,
    pageIndex + 1,
  ])
  const sortedPages = Array.from(pages)
    .filter((page) => page >= 0 && page < pageCount)
    .sort((left, right) => left - right)

  const items: Array<number | "ellipsis"> = []
  for (const page of sortedPages) {
    const previous = items.at(-1)
    if (typeof previous === "number" && page - previous > 1) {
      items.push("ellipsis")
    }
    items.push(page)
  }
  return items
}
