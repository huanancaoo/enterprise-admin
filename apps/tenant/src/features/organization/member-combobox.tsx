import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { listOrganizationMemberOptions } from "@workspace/api-client"
import { OrganizationMemberOptionsPageSchema } from "@workspace/contracts"
import { Button } from "@workspace/ui/components/button"
import {
  Combobox,
  ComboboxClear,
  ComboboxCollection,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@workspace/ui/components/combobox"
import { ChevronDownIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

export function MemberCombobox({
  organizationId,
  value,
  onValueChange,
  id,
  disabled,
  invalid,
  onBlur,
}: {
  organizationId: string
  value: string | null
  onValueChange: (value: string | null) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  onBlur?: () => void
}) {
  const { t } = useTranslation(["organization", "common"])
  const userId = useAuthenticatedSession()!.user.id
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [search, setSearch] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(text.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [text])
  const prefix = ["organizations", organizationId, "member-options", userId]
  const candidates = useInfiniteQuery({
    queryKey: [...prefix, "search", search],
    enabled: open && search === text.trim(),
    retry: false,
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) =>
      OrganizationMemberOptionsPageSchema.parse(
        (
          await listOrganizationMemberOptions(
            organizationId,
            { q: search || undefined, page: pageParam, pageSize: 20 },
            { signal }
          )
        ).data
      ),
    getNextPageParam: (page) =>
      page.page * page.pageSize < page.total ? page.page + 1 : undefined,
  })
  const selected = useQuery({
    queryKey: [...prefix, "selected", value],
    enabled: Boolean(value),
    retry: false,
    queryFn: async ({ signal }) =>
      OrganizationMemberOptionsPageSchema.parse(
        (
          await listOrganizationMemberOptions(
            organizationId,
            { userId: value!, page: 1, pageSize: 1 },
            { signal }
          )
        ).data
      ).items[0] ?? null,
  })
  const denied = candidates.isError || selected.isError
  const items = useMemo(
    () =>
      denied || search !== text.trim()
        ? []
        : [
            ...new Map(
              (candidates.data?.pages.flatMap((page) => page.items) ?? []).map(
                (item) => [item.userId, item]
              )
            ).values(),
          ],
    [candidates.data, denied, search, text]
  )
  const current = !denied ? selected.data : null
  return (
    <div className="relative min-w-0">
      <Combobox
        items={items}
        value={value}
        filter={() => true}
        disabled={disabled}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          setText("")
          setSearch("")
        }}
        inputValue={text}
        onInputValueChange={(next, details) => {
          if (details.reason === "input-change") setText(next)
        }}
        onValueChange={(next, details) => {
          if (details.reason === "clear-press") onValueChange(null)
          if (
            details.reason === "item-press" &&
            items.some((item) => item.userId === next)
          )
            onValueChange(next)
        }}
        itemToStringLabel={(itemId) =>
          items.find((item) => item.userId === itemId)?.name ??
          current?.name ??
          ""
        }
        itemToStringValue={(itemId) => itemId}
        autoHighlight
      >
        <ComboboxValue>
          {() => (
            <div className="relative">
              <ComboboxTrigger
                showIcon={false}
                id={id}
                onBlur={onBlur}
                aria-invalid={invalid || undefined}
                render={<Button type="button" variant="outline" />}
                className={`relative h-9 w-full justify-start text-start font-normal ${value ? "pe-14" : "pe-9"}`}
              >
                <span className="truncate">
                  {value
                    ? (current?.name ??
                      (selected.isPending ? t("common:loading") : value))
                    : t("organization:allAuditActors")}
                </span>
                <ChevronDownIcon
                  className="absolute end-3 top-1/2 size-4 -translate-y-1/2 opacity-50"
                  aria-hidden="true"
                />
              </ComboboxTrigger>
              {value && !disabled && (
                <ComboboxClear
                  aria-label={t("common:clearSelection")}
                  className="absolute end-8 top-1/2 size-6 -translate-y-1/2"
                />
              )}
            </div>
          )}
        </ComboboxValue>
        <ComboboxContent
          aria-label={t("organization:searchAuditMembers")}
          className="w-[min(22rem,calc(100vw-2rem))] p-0"
          align="start"
        >
          <ComboboxInput
            autoFocus
            showTrigger={false}
            placeholder={t("organization:searchAuditMembers")}
            aria-label={t("organization:searchAuditMembers")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                if (event.nativeEvent.isComposing) event.stopPropagation()
              }
            }}
          />
          <ComboboxList>
            <ComboboxCollection>
              {(item) => (
                <ComboboxItem key={item.userId} value={item.userId}>
                  <span className="truncate">{item.name}</span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
          {(candidates.isPending || search !== text.trim()) && (
            <p role="status" className="p-3 text-sm">
              {t("common:loading")}
            </p>
          )}
          {!candidates.isPending &&
            search === text.trim() &&
            !candidates.isError &&
            !items.length && (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                {t("organization:noMembers")}
              </p>
            )}
          {candidates.isError && (
            <div className="p-3">
              <p role="alert" className="text-sm text-destructive">
                {t("organization:auditMemberLoadError")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void candidates.refetch()}
              >
                {t("common:retry")}
              </Button>
            </div>
          )}
          {candidates.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={candidates.isFetchingNextPage}
              onClick={() => void candidates.fetchNextPage()}
            >
              {t("organization:loadMoreAuditMembers")}
            </Button>
          )}
        </ComboboxContent>
      </Combobox>
      {value && selected.isSuccess && !selected.data && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("organization:auditFormerMember")}
        </p>
      )}
      {selected.isError && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("organization:auditMemberLoadError")}
        </p>
      )}
    </div>
  )
}
