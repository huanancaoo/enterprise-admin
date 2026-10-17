import { useId, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Badge } from "@workspace/ui/components/badge"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@workspace/ui/components/popover"
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

export type DirectoryOption = {
  id: string
  name: string
  detail?: string
  hasChildren?: boolean
}
export type DirectoryPage = { items: DirectoryOption[]; total: number }
export type DirectoryQuery = {
  page: number
  pageSize: number
  q?: string
  parentId?: string
}
export type DirectoryLoader = (
  query: DirectoryQuery,
  signal: AbortSignal
) => Promise<DirectoryPage>

export function DirectoryError({ error }: { error: unknown }) {
  const { t } = useTranslation("common")
  return error ? (
    <p role="alert" className="text-sm text-destructive">
      {error instanceof Error ? error.message : t("operationFailed")}
    </p>
  ) : null
}

/** 候选集合按服务端分页；已选实体另读名称，避免翻页后丢失选择或把全目录载入浏览器。 */
export function DirectoryPicker({
  label,
  queryKey,
  selected,
  onChange,
  loadPage,
  loadSelected,
  selectedOptions,
  onOptionSelect,
  multiple = true,
  hierarchical = false,
  disabled = false,
  invalid = false,
  onBlur,
  inline = false,
}: {
  label: string
  queryKey: string
  selected: string[]
  onChange: (ids: string[]) => void
  loadPage: DirectoryLoader
  loadSelected?: (
    ids: string[],
    signal: AbortSignal
  ) => Promise<DirectoryOption[]>
  selectedOptions?: DirectoryOption[]
  onOptionSelect?: (option: DirectoryOption) => void
  multiple?: boolean
  hierarchical?: boolean
  disabled?: boolean
  invalid?: boolean
  onBlur?: () => void
  inline?: boolean
}) {
  const { t } = useTranslation(["employees", "common"])
  const id = useId()
  const session = useAuthenticatedSession()!
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [path, setPath] = useState<DirectoryOption[]>([])
  const pageSize = 10
  const parentId = path.at(-1)?.id
  const query = useQuery({
    queryKey: [
      "platform",
      session.user.id,
      "directory-picker",
      queryKey,
      { search, page, parentId },
    ],
    queryFn: ({ signal }) =>
      loadPage(
        {
          q: search || undefined,
          page,
          pageSize,
          parentId: search ? undefined : parentId,
        },
        signal
      ),
    retry: false,
    enabled: inline || open,
  })
  const names = useQuery({
    queryKey: [
      "platform",
      session.user.id,
      "directory-selected",
      queryKey,
      selected,
    ],
    queryFn: ({ signal }) => loadSelected!(selected, signal),
    retry: false,
    enabled: selected.length > 0 && !!loadSelected,
  })
  usePlatformAccessFailure(query.error ?? names.error)
  const pickerContent = (
    <>
      <Input
        id={id}
        aria-label={t("employees:searchOptions", { label })}
        placeholder={t("employees:searchOptions", { label })}
        value={search}
        maxLength={200}
        disabled={disabled}
        onChange={(event) => {
          setSearch(event.target.value)
          setPage(1)
        }}
      />
      {hierarchical && !search && (
        <nav
          className="flex flex-wrap gap-1 text-xs"
          aria-label={t("employees:departmentPath")}
        >
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              setPath([])
              setPage(1)
            }}
          >
            {t("employees:rootDepartments")}
          </Button>
          {path.map((node, index) => (
            <Button
              type="button"
              key={node.id}
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setPath(path.slice(0, index + 1))
                setPage(1)
              }}
            >
              {node.name}
            </Button>
          ))}
        </nav>
      )}
      <div
        className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2"
        aria-busy={query.isFetching}
      >
        {query.data?.items.map((option) => (
          <div
            key={option.id}
            className="flex items-center gap-2 rounded-md px-1 py-1.5"
          >
            <Checkbox
              id={`${id}-${option.id}`}
              checked={selected.includes(option.id)}
              disabled={disabled}
              aria-invalid={invalid}
              onCheckedChange={(checked) => {
                if (checked) onOptionSelect?.(option)
                if (!multiple && checked) setOpen(false)
                onChange(
                  checked
                    ? multiple
                      ? [...selected, option.id]
                      : [option.id]
                    : selected.filter((value) => value !== option.id)
                )
              }}
            />
            <label
              htmlFor={`${id}-${option.id}`}
              className="min-w-0 flex-1 cursor-pointer text-sm"
            >
              <span className="block truncate">{option.name}</span>
              {option.detail && (
                <bdi className="block truncate text-xs text-muted-foreground">
                  {option.detail}
                </bdi>
              )}
            </label>
            {hierarchical && !search && option.hasChildren && (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                disabled={disabled}
                aria-label={t("employees:openDepartment", {
                  name: option.name,
                })}
                onClick={() => {
                  setPath([...path, option])
                  setPage(1)
                }}
              >
                <ChevronRightIcon />
              </Button>
            )}
          </div>
        ))}
        {!query.isPending &&
          !query.isError &&
          query.data?.items.length === 0 && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              {t("employees:noOptions")}
            </p>
          )}
        {query.isPending && (
          <p
            role="status"
            className="py-2 text-center text-xs text-muted-foreground"
          >
            {t("common:loading")}
          </p>
        )}
      </div>
      <DirectoryError error={query.error ?? names.error} />
      {(query.isError || names.isError) && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            void query.refetch()
            if (selected.length && loadSelected) void names.refetch()
          }}
        >
          {t("common:retry")}
        </Button>
      )}
      {!hierarchical && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("employees:optionCount", { count: query.data?.total ?? 0 })}
          </span>
          <div className="flex gap-1">
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled || query.isFetching || page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t("common:previous")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={
                disabled ||
                query.isFetching ||
                page * pageSize >= (query.data?.total ?? 0)
              }
              onClick={() => setPage(page + 1)}
            >
              {t("common:next")}
            </Button>
          </div>
        </div>
      )}
    </>
  )
  return (
    <div
      className="space-y-2"
      role="group"
      aria-label={label}
      aria-invalid={invalid}
      onBlur={onBlur}
    >
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(selectedOptions ?? names.data ?? []).map((option) => (
            <Badge key={option.id} variant="secondary" className="gap-1 pe-1">
              {option.name}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled}
                aria-label={t("employees:clearSelection", {
                  name: option.name,
                })}
                onClick={() =>
                  onChange(selected.filter((value) => value !== option.id))
                }
              >
                <XIcon />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      {inline ? (
        <div className="space-y-2">{pickerContent}</div>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full justify-between"
                disabled={disabled}
                aria-invalid={invalid}
              />
            }
          >
            <span>{t("employees:selectOptions", { label })}</span>
            <ChevronDownIcon />
          </PopoverTrigger>
          <PopoverContent
            align="start"
            aria-label={label}
            className="w-80 space-y-2"
          >
            {pickerContent}
          </PopoverContent>
        </Popover>
      )}
      {!open && !inline && <DirectoryError error={names.error} />}
    </div>
  )
}
