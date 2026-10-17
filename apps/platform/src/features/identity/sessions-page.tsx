import { useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouteContext, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  listPlatformSessions,
  revokePlatformSession,
} from "@workspace/api-client"
import {
  PlatformSessionsPageSchema,
  PlatformSessionsQuerySchema,
  SessionRevokeResultSchema,
  type PlatformSession,
} from "@workspace/contracts/identity-management"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { UserCombobox } from "../../components/user-combobox"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { FilterIcon } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

const sessionColumns = createDataTableColumnHelper<PlatformSession>()
const EMPTY_SESSIONS: PlatformSession[] = []

export function PlatformSessionsPage() {
  const { t } = useTranslation(["identity", "common", "organization"])
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/platform/sessions" })
  const navigate = useNavigate({ from: "/platform/sessions" })
  const queryClient = useQueryClient()
  const locale = useUiLocale()
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const [selectedSession, setSelectedSession] =
    useState<PlatformSession | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterQuery = (value: { userId: string }) => ({
    ...search,
    userId: value.userId || undefined,
    page: 1,
  })
  const filtersForm = useForm({
    defaultValues: { userId: search.userId ?? "" },
    validators: {
      onSubmit: ({ value }) => {
        const result = PlatformSessionsQuerySchema.safeParse(filterQuery(value))
        if (result.success) return undefined
        return {
          fields: Object.fromEntries(
            result.error.issues.map((issue) => [
              issue.path[0],
              { message: t("organization:platformAuditInvalid") },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = PlatformSessionsQuerySchema.parse(filterQuery(value))
      await navigate({ search: parsed })
      setFiltersOpen(false)
    },
  })
  const queryKey = ["platform", session.user.id, "sessions", search] as const
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      PlatformSessionsPageSchema.parse(
        (await listPlatformSessions(search, { signal })).data
      ),
    retry: false,
  })
  const rejectAccessFailure = usePlatformAccessFailure(query.error)
  const revoke = useMutation({
    mutationFn: async (sessionId: string) =>
      SessionRevokeResultSchema.parse(
        (await revokePlatformSession(sessionId)).data
      ),
    onSuccess: async () => {
      setSelectedSession(null)
      await queryClient.invalidateQueries({
        queryKey: ["platform", session.user.id, "sessions"],
      })
    },
    onError: (error) => void rejectAccessFailure(error),
  })
  const revokePending = revoke.isPending
  const resetRevoke = revoke.reset
  const columns = useMemo(() => {
    const format = createFormatter(locale)
    const date = (value: string) =>
      format.dateTime(new Date(value), "UTC", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    return sessionColumns.columns([
      sessionColumns.accessor("name", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("user")} />
        ),
        cell: ({ row, getValue }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{getValue()}</p>
            <bdi className="text-xs text-muted-foreground">
              {row.original.maskedEmail}
            </bdi>
          </div>
        ),
        meta: { label: t("user") },
        size: 240,
      }),
      sessionColumns.accessor("userAgent", {
        header: t("userAgent"),
        cell: ({ getValue }) => (
          <span className="line-clamp-2">{getValue() ?? "—"}</span>
        ),
        meta: { label: t("userAgent") },
        size: 300,
      }),
      sessionColumns.accessor("ipAddress", {
        header: t("ipAddress"),
        cell: ({ getValue }) => (
          <bdi className="font-mono text-xs">{getValue() ?? "—"}</bdi>
        ),
        meta: { label: t("ipAddress") },
        size: 160,
      }),
      sessionColumns.accessor("createdAt", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("createdAt")} />
        ),
        cell: ({ getValue }) => date(getValue()),
        meta: { label: t("createdAt") },
        size: 190,
      }),
      sessionColumns.accessor("updatedAt", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("updatedAt")} />
        ),
        cell: ({ getValue }) => date(getValue()),
        meta: { label: t("updatedAt") },
        size: 190,
      }),
      sessionColumns.accessor("expiresAt", {
        header: ({ header }) => (
          <DataTableColumnHeader header={header} title={t("expiresAt")} />
        ),
        cell: ({ getValue }) => date(getValue()),
        meta: { label: t("expiresAt") },
        size: 190,
      }),
      ...(platformAccess.role === "platform_admin"
        ? [
            sessionColumns.display({
              id: "actions",
              header: t("revokeSession"),
              cell: ({ row }) => (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokePending}
                  onClick={() => {
                    resetRevoke()
                    setSelectedSession(row.original)
                  }}
                >
                  {t("revokeSession")}
                </Button>
              ),
              enableHiding: false,
              meta: { label: t("revokeSession") },
            }),
          ]
        : []),
    ])
  }, [locale, platformAccess.role, resetRevoke, revokePending, t])
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const status: DataTableStatus = query.isError
    ? query.error instanceof ApiClientError && query.error.status === 403
      ? "forbidden"
      : "error"
    : query.isPending
      ? "loading"
      : query.isFetching
        ? "refreshing"
        : "ready"
  const filters = search.userId ? [{ id: "userId", value: search.userId }] : []
  return (
    <section className="min-w-0 space-y-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("sessions")}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {t("sessionDescription")}
        </p>
      </header>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_SESSIONS}
        empty={
          <p className="text-sm text-muted-foreground">{t("noSessions")}</p>
        }
        getRowId={(row) => row.sessionId}
        rowCount={query.data?.total ?? 0}
        status={status}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        searchPlaceholder={t("searchSessions")}
        searchMaxLength={200}
        state={{
          pagination,
          globalFilter: search.q ?? "",
          columnFilters: filters,
        }}
        toolbarContent={
          <Popover
            open={filtersOpen}
            onOpenChange={(open) => {
              if (open) filtersForm.setFieldValue("userId", search.userId ?? "")
              setFiltersOpen(open)
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetching}
                />
              }
            >
              <FilterIcon data-icon="inline-start" />
              {t("organization:platformOperationAdvancedFilters")}
              {search.userId && <Badge variant="secondary">1</Badge>}
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="max-h-[min(40rem,calc(100dvh-4rem))] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto"
            >
              <PopoverHeader>
                <PopoverTitle>
                  {t("organization:platformOperationAdvancedFilters")}
                </PopoverTitle>
              </PopoverHeader>
              <filtersForm.Subscribe selector={(state) => state.isSubmitting}>
                {(busy) => (
                  <form
                    noValidate
                    aria-busy={busy || query.isFetching}
                    onSubmit={(event) => {
                      event.preventDefault()
                      void filtersForm.handleSubmit()
                    }}
                  >
                    <fieldset
                      disabled={busy || query.isFetching}
                      className="space-y-4"
                    >
                      <filtersForm.Field name="userId">
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          return (
                            <Field data-invalid={invalid}>
                              <FieldLabel htmlFor="platform-sessions-user">
                                {t("filterUser")}
                              </FieldLabel>
                              <UserCombobox
                                id="platform-sessions-user"
                                value={field.state.value || null}
                                placeholder={t("filterUser")}
                                onValueChange={(userId) =>
                                  field.handleChange(userId ?? "")
                                }
                                onBlur={field.handleBlur}
                                invalid={invalid}
                                aria-describedby={
                                  invalid
                                    ? "platform-sessions-user-error"
                                    : undefined
                                }
                              />
                              {invalid && (
                                <FieldError
                                  id="platform-sessions-user-error"
                                  errors={field.state.meta.errors}
                                />
                              )}
                            </Field>
                          )
                        }}
                      </filtersForm.Field>
                      <div className="flex justify-end gap-2 border-t pt-4">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFiltersOpen(false)}
                        >
                          {t("common:close")}
                        </Button>
                        <Button type="submit">
                          {t("organization:platformApplyFilters")}
                        </Button>
                      </div>
                    </fieldset>
                  </form>
                )}
              </filtersForm.Subscribe>
            </PopoverContent>
          </Popover>
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, q: q || undefined, page: 1 } })
        }}
        onResetFilters={() =>
          void navigate({ search: { page: 1, pageSize: search.pageSize } })
        }
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          void navigate({
            search: {
              ...search,
              page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            },
          })
        }}
      />
      {revoke.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("sessionRevoked")}
        </p>
      )}
      <Dialog
        open={selectedSession !== null}
        onOpenChange={(open) => !open && setSelectedSession(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("revokeSession")}</DialogTitle>
            <DialogDescription>
              {t("revokeSessionDescription")}
            </DialogDescription>
          </DialogHeader>
          {revoke.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("sessionRevokeFailed")}
            </p>
          )}
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={revoke.isPending} />}
            >
              {t("cancel")}
            </DialogClose>
            <Button
              variant="destructive"
              disabled={
                !selectedSession ||
                revoke.isPending ||
                platformAccess.role !== "platform_admin"
              }
              onClick={() =>
                selectedSession && revoke.mutate(selectedSession.sessionId)
              }
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
