import { PlatformExportButton } from "../tasks/task-actions"
import { useEffect, useMemo, useState } from "react"
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
import { Button } from "@workspace/ui/components/button"
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field"
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
    },
  })
  // URL 条件变更时回填表单；搜索和翻页不覆盖尚未应用的筛选输入。
  useEffect(() => {
    filtersForm.reset({ userId: search.userId ?? "" })
  }, [filtersForm, search.userId])
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
      ...(platformAccess.permissions.includes("platform.session:revoke")
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
  }, [locale, platformAccess.permissions, resetRevoke, revokePending, t])
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
        toolbarContent={
          platformAccess.permissions.includes("platform.session:export") && (
            <PlatformExportButton resource="session" filters={search} />
          )
        }
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
        toolbarFilters={
          <filtersForm.Subscribe selector={(state) => state.isSubmitting}>
            {(busy) => (
              <form
                className="w-full max-w-full min-w-0 sm:w-auto"
                noValidate
                aria-busy={busy || query.isFetching}
                onSubmit={(event) => {
                  event.preventDefault()
                  void filtersForm.handleSubmit()
                }}
              >
                <fieldset
                  disabled={busy || query.isFetching}
                  className="flex min-w-0 flex-wrap items-end gap-2"
                >
                  <filtersForm.Field name="userId">
                    {(field) => {
                      const invalid =
                        field.state.meta.isTouched && !field.state.meta.isValid
                      return (
                        <Field
                          data-invalid={invalid}
                          className="w-full gap-1 sm:w-56"
                        >
                          <FieldLabel
                            className="text-xs text-muted-foreground"
                            htmlFor="platform-sessions-user"
                          >
                            {t("filterUser")}
                          </FieldLabel>
                          <UserCombobox
                            disabled={busy || query.isFetching}
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
                  <Button type="submit" size="sm" className="h-9">
                    {t("organization:platformApplyFilters")}
                  </Button>
                </fieldset>
              </form>
            )}
          </filtersForm.Subscribe>
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
                !platformAccess.permissions.includes("platform.session:revoke")
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
