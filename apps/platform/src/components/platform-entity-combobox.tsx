import * as React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { ApiClientError } from "@workspace/api-client"
import {
  getPlatformOrganization,
  getPlatformUser,
  getGetPlatformOrganizationQueryKey,
  getGetPlatformUserQueryKey,
  listPlatformOrganizations,
  listPlatformUsers,
  getListPlatformOrganizationsQueryKey,
  getListPlatformUsersQueryKey,
} from "@workspace/api-client"
import {
  OrganizationIdSchema,
  PlatformOrganizationDetailSchema,
  PlatformOrganizationPageSchema,
  PlatformUserDetailSchema,
  PlatformUsersPageSchema,
  type PlatformOrganizationDetail,
  type PlatformUserDetail,
} from "@workspace/contracts"
import {
  Combobox,
  ComboboxClear,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "@workspace/ui/components/combobox"
import { Button } from "@workspace/ui/components/button"
import { InputGroupAddon } from "@workspace/ui/components/input-group"
import { usePlatformAccessFailure } from "../lib/use-platform-access-failure"
import {
  Building2Icon,
  ChevronsUpDownIcon,
  LoaderCircleIcon,
  SearchIcon,
  UserRoundIcon,
} from "lucide-react"

const PAGE_SIZE = 20
const ACTIVE_ACCESS_STATUSES = [401, 403]

type Entity = {
  id: string
  label: string
  secondary: string
  accessibleLabel: string
  status?: string
}

export interface PlatformEntityComboboxProps {
  value: string | null
  onValueChange: (id: string | null) => void
  id?: string
  onBlur?: () => void
  disabled?: boolean
  invalid?: boolean
  placeholder?: string
  "aria-describedby"?: string
}

type EntityKind = "organization" | "user"

function useDebouncedValue(value: string, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay)
    return () => window.clearTimeout(timeout)
  }, [delay, value])
  return debouncedValue
}

function isAccessFailure(error: unknown) {
  return (
    error instanceof ApiClientError &&
    ACTIVE_ACCESS_STATUSES.includes(error.status)
  )
}

function useEntityDirectory(
  kind: EntityKind,
  props: PlatformEntityComboboxProps
) {
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const searchIsSettled = search.trim() === debouncedSearch
  const exactOrganizationId =
    kind === "organization" &&
    OrganizationIdSchema.safeParse(debouncedSearch).success
      ? debouncedSearch
      : null
  const { value } = props

  const listQueryKey = useMemo(() => {
    const params =
      kind === "organization"
        ? {
            q: debouncedSearch || undefined,
            pageSize: PAGE_SIZE,
            sortBy: "createdAt" as const,
            sortOrder: "desc" as const,
          }
        : { q: debouncedSearch || undefined, pageSize: PAGE_SIZE }
    return [
      "platform",
      session.user.id,
      ...(kind === "organization"
        ? getListPlatformOrganizationsQueryKey(params)
        : getListPlatformUsersQueryKey(params)),
    ]
  }, [debouncedSearch, kind, session.user.id])

  const listQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    enabled: open && searchIsSettled && !exactOrganizationId,
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      if (kind === "organization") {
        return PlatformOrganizationPageSchema.parse(
          (
            await listPlatformOrganizations(
              {
                q: debouncedSearch || undefined,
                page: pageParam,
                pageSize: PAGE_SIZE,
                sortBy: "createdAt",
                sortOrder: "desc",
              },
              { signal }
            )
          ).data
        )
      }
      return PlatformUsersPageSchema.parse(
        (
          await listPlatformUsers(
            {
              q: debouncedSearch || undefined,
              page: pageParam,
              pageSize: PAGE_SIZE,
            },
            { signal }
          )
        ).data
      )
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total
        ? lastPage.page + 1
        : undefined,
    retry: false,
  })

  useEffect(() => {
    if (searchIsSettled) return
    void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true })
  }, [listQueryKey, queryClient, searchIsSettled])
  useEffect(() => {
    if (open) return
    void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true })
  }, [listQueryKey, open, queryClient])
  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: listQueryKey, exact: true })
    },
    [listQueryKey, queryClient]
  )

  const selectedKey = useMemo(
    () => [
      "platform",
      session.user.id,
      ...(kind === "organization"
        ? getGetPlatformOrganizationQueryKey(value ?? "")
        : getGetPlatformUserQueryKey(value ?? "")),
    ],
    [kind, session.user.id, value]
  )
  const selectedQuery = useQuery({
    queryKey: selectedKey,
    enabled: Boolean(value),
    queryFn: async ({ signal }) => {
      if (kind === "organization")
        return PlatformOrganizationDetailSchema.parse(
          (await getPlatformOrganization(value!, { signal })).data
        )
      return PlatformUserDetailSchema.parse(
        (await getPlatformUser(value!, { signal })).data
      )
    },
    retry: false,
  })
  useEffect(
    () => () => {
      void queryClient.cancelQueries({ queryKey: selectedKey, exact: true })
    },
    [queryClient, selectedKey]
  )

  const exactOrganizationKey = useMemo(
    () => [
      "platform",
      session.user.id,
      ...getGetPlatformOrganizationQueryKey(exactOrganizationId ?? ""),
    ],
    [exactOrganizationId, session.user.id]
  )
  const exactOrganizationQuery = useQuery({
    queryKey: exactOrganizationKey,
    enabled: open && searchIsSettled && Boolean(exactOrganizationId),
    queryFn: async ({ signal }) => {
      return PlatformOrganizationDetailSchema.parse(
        (await getPlatformOrganization(exactOrganizationId!, { signal })).data
      )
    },
    retry: false,
  })
  useEffect(() => {
    if (exactOrganizationId === value) return
    if (open && searchIsSettled && exactOrganizationId) return
    void queryClient.cancelQueries({
      queryKey: exactOrganizationKey,
      exact: true,
    })
  }, [
    exactOrganizationId,
    exactOrganizationKey,
    open,
    queryClient,
    searchIsSettled,
    value,
  ])
  useEffect(() => {
    if (exactOrganizationId === value) return
    return () => {
      void queryClient.cancelQueries({
        queryKey: exactOrganizationKey,
        exact: true,
      })
    }
  }, [exactOrganizationId, exactOrganizationKey, queryClient, value])

  const accessFailure = [
    listQuery.error,
    selectedQuery.error,
    exactOrganizationQuery.error,
  ].find(isAccessFailure)
  usePlatformAccessFailure(accessFailure)
  const accessDenied = Boolean(accessFailure)

  const items = useMemo<Entity[]>(() => {
    if (accessDenied) return []
    if (kind === "organization" && exactOrganizationId) {
      const record = exactOrganizationQuery.data
      return record ? [organizationEntity(record)] : []
    }
    const pages = listQuery.data?.pages ?? []
    const unique = new Map<string, Entity>()
    for (const page of pages) {
      for (const item of page.items) {
        const entity =
          "slug" in item ? organizationEntity(item) : userEntity(item)
        if (!unique.has(entity.id)) unique.set(entity.id, entity)
      }
    }
    return [...unique.values()]
  }, [
    accessDenied,
    exactOrganizationId,
    exactOrganizationQuery.data,
    kind,
    listQuery.data,
  ])

  const selectedRecord = accessDenied ? undefined : selectedQuery.data
  const selectedEntity = selectedRecord
    ? kind === "organization"
      ? organizationEntity(selectedRecord as PlatformOrganizationDetail)
      : userEntity(selectedRecord as PlatformUserDetail)
    : undefined
  const selectedNotFound =
    selectedQuery.error instanceof ApiClientError &&
    selectedQuery.error.status === 404

  return {
    open,
    setOpen,
    search,
    setSearch,
    searchIsSettled,
    exactOrganizationId,
    listQuery,
    exactOrganizationQuery,
    selectedQuery,
    selectedEntity,
    selectedNotFound,
    accessDenied,
    items,
  }
}

function organizationEntity(
  organization:
    | PlatformOrganizationDetail
    | { id: string; name: string; slug: string; status: string }
): Entity {
  return {
    id: organization.id,
    label: organization.name,
    secondary: organization.slug,
    accessibleLabel: `${organization.name}, ${organization.status}, ${organization.slug}, ${organization.id}`,
    status: organization.status,
  }
}

function userEntity(
  user:
    PlatformUserDetail | { userId: string; name: string; maskedEmail: string }
): Entity {
  return {
    id: user.userId,
    label: user.name,
    secondary: user.maskedEmail,
    accessibleLabel: `${user.name}, ${user.maskedEmail}, ${user.userId}`,
  }
}

export function PlatformEntityCombobox({
  kind,
  props,
}: {
  kind: EntityKind
  props: PlatformEntityComboboxProps
}) {
  const { t } = useTranslation(["organization", "common"])
  const state = useEntityDirectory(kind, props)
  const rootRef = useRef<HTMLDivElement>(null)
  const unavailableStatusId = React.useId()
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const loadMorePendingRef = useRef(false)
  const compositionRef = useRef(false)
  const focusWithinRef = useRef(false)
  const [lastLoadedCount, setLastLoadedCount] = useState(0)
  const {
    value,
    onValueChange,
    id,
    onBlur,
    disabled,
    invalid,
    placeholder,
    "aria-describedby": ariaDescribedBy,
  } = props
  const searchPlaceholder = t(
    kind === "organization"
      ? "platformEntityOrganizationSearchPlaceholder"
      : "platformEntityUserSearchPlaceholder"
  )
  const defaultPlaceholder = t(
    kind === "organization"
      ? "platformEntityOrganizationPlaceholder"
      : "platformEntityUserPlaceholder"
  )
  const activeError = state.exactOrganizationId
    ? state.exactOrganizationQuery.error
    : state.listQuery.error
  const selectedError = state.selectedQuery.error
  const exactNotFound =
    activeError instanceof ApiClientError && activeError.status === 404
  const isNextPageFailure =
    !state.exactOrganizationId && state.listQuery.isFetchNextPageError
  const listFailed = Boolean(
    activeError && !exactNotFound && !isNextPageFailure
  )
  const selectedFailed = Boolean(selectedError && !state.selectedNotFound)
  const isInitialLoading =
    state.open &&
    (!state.searchIsSettled ||
      (state.exactOrganizationId
        ? state.exactOrganizationQuery.isPending
        : state.listQuery.isPending))
  const isLoadingMore = state.listQuery.isFetchingNextPage
  const hasMore = !state.exactOrganizationId && state.listQuery.hasNextPage
  const shouldShowNoResults =
    state.open &&
    state.searchIsSettled &&
    !isInitialLoading &&
    !listFailed &&
    !state.accessDenied &&
    state.items.length === 0

  useEffect(() => {
    if (!state.open) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [state.open])

  const focusInputAfterAction = async (action: () => Promise<unknown>) => {
    await action()
    if (state.open) inputRef.current?.focus()
  }

  const handleFocusIn = () => {
    focusWithinRef.current = true
  }

  const handleFocusOut = (event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (
      nextTarget instanceof Node &&
      (rootRef.current?.contains(nextTarget) ||
        popupRef.current?.contains(nextTarget))
    )
      return
    requestAnimationFrame(() => {
      const activeElement = document.activeElement
      if (
        activeElement instanceof Node &&
        (rootRef.current?.contains(activeElement) ||
          popupRef.current?.contains(activeElement))
      )
        return
      if (focusWithinRef.current) {
        focusWithinRef.current = false
        onBlur?.()
      }
    })
  }

  const handleValueChange = (
    nextValue: string | null,
    eventDetails: { reason: string }
  ) => {
    if (eventDetails.reason === "item-press" && nextValue) {
      if (state.items.some((item) => item.id === nextValue))
        onValueChange(nextValue)
      return
    }
    if (eventDetails.reason === "clear-press") {
      onValueChange(null)
      state.setOpen(false)
    }
  }

  const handleInputValueChange = (
    nextSearch: string,
    eventDetails: { reason: string }
  ) => {
    if (eventDetails.reason === "input-change") state.setSearch(nextSearch)
  }

  return (
    <div
      ref={rootRef}
      className="relative w-full min-w-0"
      onFocusCapture={handleFocusIn}
      onBlurCapture={handleFocusOut}
    >
      <Combobox
        items={state.searchIsSettled ? state.items : []}
        value={value}
        open={state.open}
        onOpenChange={(open) => {
          state.setOpen(open)
          state.setSearch("")
        }}
        onInputValueChange={handleInputValueChange}
        inputValue={state.search}
        onValueChange={handleValueChange}
        itemToStringLabel={(itemId) =>
          state.items.find((item) => item.id === itemId)?.label ??
          state.selectedEntity?.label ??
          ""
        }
        itemToStringValue={(itemId) => itemId}
        filter={() => true}
        autoHighlight
        disabled={disabled}
      >
        <ComboboxValue>
          {(selectedValue: string | null) => {
            const isSelected = Boolean(selectedValue)
            const isValuePending = Boolean(
              isSelected && state.selectedQuery.isPending && !state.accessDenied
            )
            const isValueNotFound = Boolean(
              isSelected && state.selectedNotFound
            )
            const selectedLabel = state.accessDenied
              ? t("platformEntitySelectionUnavailable")
              : state.selectedEntity?.label
            const label = isSelected
              ? (selectedLabel ??
                (isValueNotFound
                  ? selectedValue
                  : isValuePending
                    ? t("platformEntityLoadingCurrentValue")
                    : t("platformEntityRecordLoadError")))
              : (placeholder ?? defaultPlaceholder)
            const clearable = isSelected && !disabled && !state.accessDenied
            return (
              <div className="relative w-full">
                <ComboboxTrigger
                  ref={triggerRef}
                  render={<Button type="button" variant="outline" />}
                  showIcon={false}
                  id={id}
                  aria-invalid={invalid || undefined}
                  aria-describedby={
                    [
                      ariaDescribedBy,
                      state.selectedNotFound && !state.accessDenied
                        ? unavailableStatusId
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  aria-label={label}
                  className={[
                    "relative h-9 w-full justify-start text-start font-normal",
                    clearable ? "pe-14" : "pe-9",
                    !isSelected && "text-muted-foreground",
                    invalid &&
                      "border-destructive focus-visible:ring-destructive/20",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start overflow-hidden">
                    <span className="w-full truncate text-sm">
                      {state.accessDenied && isSelected ? "" : label}
                    </span>
                    {isSelected &&
                      state.selectedEntity?.secondary &&
                      kind === "user" && (
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {state.selectedEntity.secondary}
                        </span>
                      )}
                    {selectedFailed && !state.accessDenied && value && (
                      <span
                        className="w-full truncate text-xs text-muted-foreground"
                        title={value}
                      >
                        {value}
                      </span>
                    )}
                  </span>
                  {isValuePending && (
                    <LoaderCircleIcon
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  <ChevronsUpDownIcon
                    className="absolute end-3 top-1/2 size-4 -translate-y-1/2 opacity-50"
                    aria-hidden="true"
                  />
                </ComboboxTrigger>
                {clearable && (
                  <ComboboxClear
                    tabIndex={0}
                    aria-label={t("common:clearSelection")}
                    className="absolute end-8 top-1/2 size-6 -translate-y-1/2 rounded text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                  />
                )}
              </div>
            )
          }}
        </ComboboxValue>
        <ComboboxContent
          ref={popupRef}
          finalFocus={triggerRef}
          align="start"
          className="w-[min(400px,calc(100vw-2rem))] min-w-[min(260px,calc(100vw-2rem))] p-0"
          aria-label={searchPlaceholder}
          onFocusCapture={handleFocusIn}
          onBlurCapture={handleFocusOut}
          onKeyDownCapture={(event) => {
            const nativeEvent = event.nativeEvent
            // 部分输入法仅通过 229 标记候选确认，必须识别它以阻止表单提交。
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- 输入法候选确认事件
            const legacyWhich = nativeEvent.which === 229
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- 输入法候选确认事件
            const legacyKeyCode = nativeEvent.keyCode === 229
            const isLegacyCompositionKey = legacyWhich || legacyKeyCode
            const isComposingEnter =
              event.key === "Enter" &&
              event.target === inputRef.current &&
              (compositionRef.current || nativeEvent.isComposing)
            if (isLegacyCompositionKey || isComposingEnter) {
              event.preventDefault()
              event.stopPropagation()
            } else if (
              event.key === "Enter" &&
              event.target === inputRef.current
            ) {
              // Base UI still handles highlighted-item selection after capture; prevent only form submission.
              event.preventDefault()
              if (!inputRef.current?.hasAttribute("aria-activedescendant"))
                event.stopPropagation()
            }
          }}
        >
          <ComboboxInput
            ref={inputRef}
            showTrigger={false}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-autocomplete="list"
            onCompositionStart={() => {
              compositionRef.current = true
            }}
            onCompositionEnd={() => {
              compositionRef.current = false
            }}
          >
            <InputGroupAddon>
              <SearchIcon
                className="size-4 shrink-0 opacity-50"
                aria-hidden="true"
              />
            </InputGroupAddon>
          </ComboboxInput>
          <ComboboxEmpty className="py-5">
            {shouldShowNoResults &&
              t(
                kind === "organization"
                  ? "platformEntityNoOrganizations"
                  : "platformEntityNoUsers"
              )}
          </ComboboxEmpty>
          <ComboboxList aria-label={searchPlaceholder} className="max-h-72">
            <ComboboxCollection>
              {(item: Entity) => (
                <ComboboxItem
                  key={item.id}
                  value={item.id}
                  aria-label={item.accessibleLabel}
                  className="min-h-14 cursor-pointer rounded-lg py-2"
                >
                  {kind === "organization" ? (
                    <Building2Icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : (
                    <UserRoundIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col items-start overflow-hidden">
                    <span className="flex w-full items-center gap-2 truncate text-sm font-medium">
                      <span className="truncate">{item.label}</span>
                      {item.status && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-foreground">
                          {t(
                            item.status === "ACTIVE"
                              ? "platformActive"
                              : "platformSuspended"
                          )}
                        </span>
                      )}
                    </span>
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {kind === "user"
                        ? `${item.secondary} · ${item.id.slice(-8)}`
                        : item.secondary}
                    </span>
                    {kind === "user" && (
                      <span className="sr-only">{item.id}</span>
                    )}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxList>
          {isInitialLoading && (
            <p
              role="status"
              className="px-4 py-3 text-sm text-muted-foreground"
            >
              {t(
                kind === "organization"
                  ? "platformEntityOrganizationsLoading"
                  : "platformEntityUsersLoading"
              )}
            </p>
          )}
          {listFailed && !state.accessDenied && (
            <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
              <p role="status" className="text-sm text-destructive">
                {t(
                  kind === "organization"
                    ? "platformEntityOrganizationsLoadError"
                    : "platformEntityUsersLoadError"
                )}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  void focusInputAfterAction(() =>
                    state.exactOrganizationId
                      ? state.exactOrganizationQuery.refetch()
                      : state.listQuery.refetch()
                  )
                }
              >
                {t("platformEntityRetry")}
              </Button>
            </div>
          )}
          {hasMore && !listFailed && (
            <div className="border-t px-3 py-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full"
                aria-disabled={isLoadingMore || undefined}
                aria-busy={isLoadingMore || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() =>
                  void focusInputAfterAction(async () => {
                    if (isLoadingMore || loadMorePendingRef.current) return
                    loadMorePendingRef.current = true
                    setLastLoadedCount(0)
                    const knownIds = new Set(state.items.map((item) => item.id))
                    const previousPageCount =
                      state.listQuery.data?.pages.length ?? 0
                    try {
                      const result = await state.listQuery.fetchNextPage()
                      const latestPage =
                        result.data?.pages.length === previousPageCount + 1
                          ? result.data.pages.at(-1)
                          : undefined
                      const addedIds = new Set<string>()
                      if (latestPage) {
                        for (const item of latestPage?.items ?? []) {
                          const itemId = "slug" in item ? item.id : item.userId
                          if (!knownIds.has(itemId)) {
                            knownIds.add(itemId)
                            addedIds.add(itemId)
                          }
                        }
                      }
                      setLastLoadedCount(addedIds.size)
                    } finally {
                      loadMorePendingRef.current = false
                    }
                  })
                }
              >
                {isLoadingMore ? (
                  <LoaderCircleIcon
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {state.listQuery.isFetchNextPageError
                  ? t("platformEntityRetry")
                  : t("platformEntityLoadMore")}
              </Button>
            </div>
          )}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {lastLoadedCount > 0 &&
              t("platformEntityLoadedCount", { total: lastLoadedCount })}
          </p>
        </ComboboxContent>
      </Combobox>
      {selectedFailed && !state.accessDenied && value && (
        <div className="mt-1 flex items-start justify-between gap-3">
          <p role="status" className="text-xs text-destructive">
            {t("platformEntityRecordLoadError")}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              void state.selectedQuery.refetch().then(() => {
                if (state.open) inputRef.current?.focus()
                else triggerRef.current?.focus()
              })
            }
          >
            {t("platformEntityRetry")}
          </Button>
        </div>
      )}
      {state.selectedNotFound && value && !state.accessDenied && (
        <div
          id={unavailableStatusId}
          className="mt-1 text-xs text-muted-foreground"
          role="status"
        >
          <p>{t("platformEntityNotInCurrentDirectory")}</p>
        </div>
      )}
    </div>
  )
}
