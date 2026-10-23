import { createContext, useContext, useMemo, useState } from "react"
import {
  Link,
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { AdminPage, ConfirmDangerAction } from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import {
  createPlatformSchedule,
  deletePlatformSchedule,
  listPlatformSchedules,
  listPlatformScheduleTypes,
  listPlatformScheduleRuns,
  runPlatformSchedule,
  updatePlatformSchedule,
} from "@workspace/api-client"
import {
  PlatformSchedulePageSchema,
  PlatformScheduleRunPageSchema,
  PlatformScheduleTypesSchema,
  type CreatePlatformSchedule,
  type PlatformSchedule,
  type PlatformScheduleRun,
} from "@workspace/contracts/platform-schedules"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { ScheduleEditor } from "./editor"

const schedules = createDataTableColumnHelper<PlatformSchedule>()
const runs = createDataTableColumnHelper<PlatformScheduleRun>()
const EMPTY_SCHEDULES: PlatformSchedule[] = []
const EMPTY_RUNS: PlatformScheduleRun[] = []
const dateTimeOptions = { dateStyle: "medium", timeStyle: "medium" } as const
const initial: CreatePlatformSchedule = {
  name: "",
  type: "platform.health-check",
  cron: "*/5 * * * *",
  timeZone: "Asia/Shanghai",
  status: "enabled",
}

export function PlatformSchedulesPage() {
  const { t } = useTranslation(["monitor", "common", "catalogs"])
  const user = useAuthenticatedSession()!.user
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const search = useSearch({ from: "/platform/schedules" })
  const navigate = useNavigate({ from: "/platform/schedules" })
  const client = useQueryClient()
  const locale = useUiLocale()
  const [editing, setEditing] = useState<PlatformSchedule | "new" | null>(null)
  const [notice, setNotice] = useState<string>()
  const prefix = ["platform", user.id, "schedules"]
  const query = useQuery({
    queryKey: [...prefix, search],
    queryFn: async ({ signal }) =>
      PlatformSchedulePageSchema.parse(
        (await listPlatformSchedules(search, { signal })).data
      ),
    retry: false,
  })
  const types = useQuery({
    queryKey: [...prefix, "types"],
    queryFn: async ({ signal }) =>
      PlatformScheduleTypesSchema.parse(
        (await listPlatformScheduleTypes({ signal })).data
      ),
    retry: false,
  })
  const canManage = platformAccess.permissions.includes(
    "platform.schedule:manage"
  )
  const canEdit =
    canManage && platformAccess.permissions.includes("platform.monitor:read")
  const canRun =
    platformAccess.permissions.includes("platform.schedule:run") &&
    platformAccess.permissions.includes("platform.monitor:read")
  const execute = useMutation({
    mutationFn: async (schedule: PlatformSchedule) =>
      runPlatformSchedule(schedule.id),
    onSuccess: async (_, schedule) => {
      setNotice(t("monitor:scheduleRunSubmitted", { name: schedule.name }))
      await client.invalidateQueries({ queryKey: prefix })
    },
  })
  usePlatformAccessFailure(query.error ?? types.error ?? execute.error)
  const statusLabels = useMemo(
    () => ({
      enabled: t("monitor:scheduleEnabled"),
      disabled: t("monitor:scheduleDisabled"),
    }),
    [t]
  )
  const columns = useMemo(
    () =>
      schedules.columns([
        schedules.accessor("name", {
          header: t("monitor:scheduleName"),
          size: 220,
          meta: { label: t("monitor:scheduleName") },
        }),
        schedules.accessor("type", {
          header: t("monitor:scheduleType"),
          cell: () => t("monitor:healthCheckType"),
          size: 200,
          enableSorting: false,
          meta: { label: t("monitor:scheduleType") },
        }),
        schedules.accessor("cron", {
          header: t("monitor:scheduleTiming"),
          enableSorting: false,
          size: 200,
          cell: ({ row }) => (
            <div>
              <p className="font-mono" dir="ltr">
                {row.original.cron}
              </p>
              <p className="text-xs text-muted-foreground" dir="ltr">
                {row.original.timeZone}
              </p>
            </div>
          ),
          meta: { label: t("monitor:scheduleTiming") },
        }),
        schedules.accessor("status", {
          header: t("monitor:scheduleStatus"),
          cell: ({ getValue }) => (
            <Badge variant={getValue() === "enabled" ? "secondary" : "outline"}>
              {statusLabels[getValue()]}
            </Badge>
          ),
          enableSorting: false,
          size: 120,
          meta: {
            label: t("monitor:scheduleStatus"),
            facetMode: "single",
            facetOptions: Object.entries(statusLabels).map(
              ([value, label]) => ({ value, label })
            ),
          },
        }),
        schedules.accessor("nextRunAt", {
          header: t("monitor:nextRunAt"),
          size: 240,
          cell: ({ row, getValue }) =>
            getValue()
              ? createFormatter(locale).dateTime(
                  new Date(getValue()!),
                  row.original.timeZone,
                  dateTimeOptions
                )
              : "—",
          meta: { label: t("monitor:nextRunAt") },
        }),
        schedules.accessor("lastRunAt", {
          header: t("monitor:lastRunAt"),
          size: 240,
          enableSorting: false,
          cell: ({ row, getValue }) =>
            getValue()
              ? createFormatter(locale).dateTime(
                  new Date(getValue()!),
                  row.original.timeZone,
                  dateTimeOptions
                )
              : "—",
          meta: { label: t("monitor:lastRunAt") },
        }),
        schedules.display({
          id: "actions",
          header: t("catalogs:actions"),
          size: 330,
          cell: ({ row }) => <ScheduleActions schedule={row.original} />,
        }),
      ]),
    [t, statusLabels, locale]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  const columnFilters = search.status
    ? [{ id: "status", value: search.status }]
    : []
  return (
    <AdminPage
      title={t("monitor:schedulesTitle")}
      actions={
        getDataTableQueryStatus(query) !== "forbidden" &&
        canManage && (
          <Button
            size="sm"
            disabled={
              !types.data?.some(
                (type) =>
                  type.type === "platform.health-check" &&
                  type.requiredPermissions.every((permission) =>
                    platformAccess.permissions.includes(permission)
                  )
              )
            }
            onClick={() => setEditing("new")}
          >
            {t("monitor:createSchedule")}
          </Button>
        )
      }
      description={t("monitor:schedulesDescription")}
    >
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {execute.error && (
        <p role="alert" className="text-sm text-destructive">
          {execute.error.message}
        </p>
      )}
      {types.error && canManage && (
        <p role="alert" className="text-sm text-destructive">
          {types.error.message}
        </p>
      )}
      {canManage && !canEdit && (
        <p className="text-sm text-muted-foreground">
          {t("monitor:schedulePermissionHint")}
        </p>
      )}
      <ScheduleActionsContext
        value={{
          canManage,
          canEdit,
          canReadRuns: platformAccess.permissions.includes(
            "platform.monitor:read"
          ),
          canRun,
          runPending: execute.isPending,
          onEdit: setEditing,
          onRun: (schedule) => {
            setNotice(undefined)
            execute.mutate(schedule)
          },
          onChanged: () => client.invalidateQueries({ queryKey: prefix }),
        }}
      >
        <DataTable
          columns={columns}
          data={query.data?.items ?? EMPTY_SCHEDULES}
          rowCount={query.data?.total ?? 0}
          getRowId={(row) => row.id}
          status={getDataTableQueryStatus(query)}
          error={query.error?.message}
          onRetry={() => void query.refetch()}
          empty={<p>{t("monitor:noSchedules")}</p>}
          manualPagination
          manualFiltering
          manualSorting
          enableRowSelection={false}
          enableMultiSort={false}
          searchPlaceholder={t("monitor:searchSchedules")}
          state={{
            pagination,
            sorting,
            columnFilters,
            globalFilter: search.q ?? "",
          }}
          toolbarActions={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                {t("monitor:refresh")}
              </Button>
            </>
          }
          onGlobalFilterChange={(updater) => {
            const q =
              typeof updater === "function" ? updater(search.q ?? "") : updater
            void navigate({ search: { ...search, page: 1, q: q || undefined } })
          }}
          onColumnFiltersChange={(updater) => {
            const next =
              typeof updater === "function" ? updater(columnFilters) : updater
            const status = next.find((filter) => filter.id === "status")?.value
            void navigate({
              search: {
                ...search,
                page: 1,
                status:
                  status === "enabled" || status === "disabled"
                    ? status
                    : undefined,
              },
            })
          }}
          onSortingChange={(updater) => {
            const next = (
              typeof updater === "function" ? updater(sorting) : updater
            )[0]
            void navigate({
              search: {
                ...search,
                page: 1,
                sortBy:
                  next?.id === "name" || next?.id === "nextRunAt"
                    ? next.id
                    : "createdAt",
                sortOrder: next?.desc ? "desc" : "asc",
              },
            })
          }}
          onPaginationChange={(updater) => {
            const next =
              typeof updater === "function" ? updater(pagination) : updater
            void navigate({
              search: {
                ...search,
                page:
                  next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
                pageSize: next.pageSize,
              },
            })
          }}
          onResetFilters={() =>
            void navigate({
              search: { ...search, page: 1, q: undefined, status: undefined },
            })
          }
        />
      </ScheduleActionsContext>
      {editing && (
        <ScheduleEditor
          editing={editing !== "new"}
          initial={
            editing === "new"
              ? initial
              : {
                  name: editing.name,
                  type: editing.type,
                  cron: editing.cron,
                  timeZone: editing.timeZone,
                  status: editing.status,
                }
          }
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            if (editing === "new") await createPlatformSchedule(value)
            else
              await updatePlatformSchedule(editing.id, {
                ...value,
                expectedVersion: editing.version,
              })
            await client.invalidateQueries({ queryKey: prefix })
          }}
        />
      )}
    </AdminPage>
  )
}

type ScheduleActionHandlers = {
  canManage: boolean
  canEdit: boolean
  canReadRuns: boolean
  canRun: boolean
  runPending: boolean
  onEdit: (schedule: PlatformSchedule) => void
  onRun: (schedule: PlatformSchedule) => void
  onChanged: () => Promise<unknown>
}
const ScheduleActionsContext = createContext<ScheduleActionHandlers | null>(
  null
)

function ScheduleActions({ schedule }: { schedule: PlatformSchedule }) {
  const {
    canManage,
    canEdit,
    canReadRuns,
    canRun,
    runPending,
    onEdit,
    onRun,
    onChanged,
  } = useContext(ScheduleActionsContext)!
  const { t } = useTranslation(["monitor", "common", "catalogs"])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const change = useMutation({
    mutationFn: async () =>
      updatePlatformSchedule(schedule.id, {
        name: schedule.name,
        type: schedule.type,
        cron: schedule.cron,
        timeZone: schedule.timeZone,
        status: schedule.status === "enabled" ? "disabled" : "enabled",
        expectedVersion: schedule.version,
      }),
    onSuccess: () => onChanged(),
  })
  const remove = useMutation({
    mutationFn: async () => deletePlatformSchedule(schedule.id),
    onSuccess: async () => {
      setDeleteOpen(false)
      await onChanged()
    },
  })
  usePlatformAccessFailure(change.error ?? remove.error)
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {canReadRuns && (
          <Button
            size="xs"
            variant="ghost"
            nativeButton={false}
            role="link"
            render={
              <Link
                to="/platform/schedules/$scheduleId/runs"
                params={{ scheduleId: schedule.id }}
                search={{ page: 1, pageSize: 20 }}
              />
            }
          >
            {t("monitor:scheduleRuns")}
          </Button>
        )}
        {canRun && (
          <Button
            size="xs"
            variant="outline"
            disabled={runPending}
            onClick={() => onRun(schedule)}
          >
            {t("monitor:runSchedule")}
          </Button>
        )}
        {canEdit && (
          <>
            <Button size="xs" variant="ghost" onClick={() => onEdit(schedule)}>
              {t("catalogs:edit")}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={change.isPending}
              onClick={() => change.mutate()}
            >
              {schedule.status === "enabled"
                ? t("monitor:disableSchedule")
                : t("monitor:enableSchedule")}
            </Button>
          </>
        )}
        {canManage && (
          <ConfirmDangerAction
            open={deleteOpen}
            onOpenChange={(open) => {
              setDeleteOpen(open)
              if (open) remove.reset()
            }}
            triggerLabel={t("catalogs:delete")}
            title={t("monitor:deleteSchedule")}
            description={t("monitor:deleteScheduleHint", {
              name: schedule.name,
            })}
            confirmLabel={t("catalogs:delete")}
            cancelLabel={t("common:cancel")}
            pendingLabel={t("common:submitting")}
            pending={remove.isPending}
            error={remove.error?.message}
            onConfirm={() => remove.mutate()}
          />
        )}
      </div>
      {change.error && (
        <p role="alert" className="text-xs text-destructive">
          {change.error.message}
        </p>
      )}
    </div>
  )
}

export function PlatformScheduleRunsPage() {
  const { t } = useTranslation(["monitor", "common", "catalogs"])
  const user = useAuthenticatedSession()!.user
  const { scheduleId } = useParams({
    from: "/platform/schedules/$scheduleId/runs",
  })
  const search = useSearch({ from: "/platform/schedules/$scheduleId/runs" })
  const navigate = useNavigate({ from: "/platform/schedules/$scheduleId/runs" })
  const locale = useUiLocale()
  const statuses = {
    running: t("monitor:runRunning"),
    succeeded: t("monitor:runSucceeded"),
    failed: t("monitor:runFailed"),
    rejected: t("monitor:runRejected"),
  }
  const triggers = {
    manual: t("monitor:triggerManual"),
    automatic: t("monitor:triggerAutomatic"),
  }
  const errors = {
    FORBIDDEN: t("monitor:runForbidden"),
    ACCOUNT_SUSPENDED: t("monitor:runAccountSuspended"),
    ASSIGNMENT_INACTIVE: t("monitor:runAssignmentInactive"),
    EXECUTION_FAILED: t("monitor:runExecutionFailed"),
    INTERRUPTED: t("monitor:runInterrupted"),
    AUTHORIZATION_UNAVAILABLE: t("monitor:runAuthorizationUnavailable"),
  }
  const query = useQuery({
    queryKey: ["platform", user.id, "schedule-runs", scheduleId, search],
    queryFn: async ({ signal }) =>
      PlatformScheduleRunPageSchema.parse(
        (await listPlatformScheduleRuns(scheduleId, search, { signal })).data
      ),
    retry: false,
    refetchInterval: (query) =>
      query.state.error
        ? false
        : query.state.data?.items.some((run) => run.status === "running")
          ? 1500
          : false,
  })
  usePlatformAccessFailure(query.error)
  const columns = runs.columns([
    runs.accessor("startedAt", {
      header: t("monitor:runStartedAt"),
      size: 240,
      cell: ({ getValue }) =>
        createFormatter(locale).dateTime(
          new Date(getValue()),
          "UTC",
          dateTimeOptions
        ),
      meta: { label: t("monitor:runStartedAt") },
    }),
    runs.accessor("finishedAt", {
      header: t("monitor:runFinishedAt"),
      size: 240,
      cell: ({ getValue }) =>
        getValue()
          ? createFormatter(locale).dateTime(
              new Date(getValue()!),
              "UTC",
              dateTimeOptions
            )
          : "—",
      meta: { label: t("monitor:runFinishedAt") },
    }),
    runs.accessor("trigger", {
      header: t("monitor:runTrigger"),
      size: 120,
      cell: ({ getValue }) => triggers[getValue()],
      meta: { label: t("monitor:runTrigger") },
    }),
    runs.accessor("status", {
      header: t("monitor:runStatus"),
      size: 130,
      cell: ({ getValue }) => (
        <Badge
          variant={
            getValue() === "failed" || getValue() === "rejected"
              ? "destructive"
              : "secondary"
          }
        >
          {statuses[getValue()]}
        </Badge>
      ),
      meta: {
        label: t("monitor:runStatus"),
        facetMode: "single",
        facetOptions: Object.entries(statuses).map(([value, label]) => ({
          value,
          label,
        })),
      },
    }),
    runs.accessor("durationMs", {
      header: t("monitor:runDuration"),
      size: 120,
      cell: ({ getValue }) =>
        getValue() === null
          ? "—"
          : t("monitor:durationMs", { value: getValue()! }),
      meta: { label: t("monitor:runDuration") },
    }),
    runs.display({
      id: "result",
      header: t("monitor:runResult"),
      size: 400,
      cell: ({ row }) =>
        row.original.result ? (
          <div className="flex flex-wrap gap-1">
            {row.original.result.probes.map((probe) => (
              <Badge
                key={probe.key}
                variant={probe.status === "down" ? "destructive" : "outline"}
              >
                {t("monitor:probeResult", {
                  dependency: t(`monitor:dependency-${probe.key}`),
                  status: t(`monitor:status-${probe.status}`),
                })}
              </Badge>
            ))}
          </div>
        ) : row.original.errorCode ? (
          <span className="text-destructive">
            {errors[row.original.errorCode]}
          </span>
        ) : (
          "—"
        ),
    }),
  ])
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const columnFilters = search.status
    ? [{ id: "status", value: search.status }]
    : []
  return (
    <AdminPage
      title={t("monitor:scheduleRuns")}
      description={query.data?.items[0]?.scheduleName}
      meta={
        <Badge variant="outline">
          {t("monitor:runTimeZone", { timeZone: "UTC" })}
        </Badge>
      }
      back={
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          role="link"
          render={
            <Link
              to="/platform/schedules"
              search={{
                page: 1,
                pageSize: 20,
                sortBy: "createdAt",
                sortOrder: "desc",
              }}
            />
          }
        >
          {t("monitor:backToSchedules")}
        </Button>
      }
    >
      <p className="text-xs text-muted-foreground">
        {t("monitor:scheduleResultHint")}
      </p>
      <DataTable
        paginationLabel={t("monitor:scheduleRuns")}
        columns={columns}
        data={query.data?.items ?? EMPTY_RUNS}
        rowCount={query.data?.total ?? 0}
        getRowId={(row) => row.id}
        status={getDataTableQueryStatus(query)}
        error={query.error?.message}
        onRetry={() => void query.refetch()}
        empty={<p>{t("monitor:noScheduleRuns")}</p>}
        manualPagination
        manualFiltering
        enableSorting={false}
        enableRowSelection={false}
        showSearch={false}
        state={{ pagination, columnFilters }}
        toolbarActions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("monitor:refresh")}
          </Button>
        }
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const status = next.find((filter) => filter.id === "status")?.value
          void navigate({
            search: {
              ...search,
              page: 1,
              status:
                status === "running" ||
                status === "succeeded" ||
                status === "failed" ||
                status === "rejected"
                  ? status
                  : undefined,
            },
          })
        }}
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
        onResetFilters={() =>
          void navigate({ search: { ...search, page: 1, status: undefined } })
        }
      />
    </AdminPage>
  )
}
