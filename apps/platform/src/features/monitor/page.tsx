import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { RefreshCwIcon } from "lucide-react"
import { getPlatformMonitor } from "@workspace/api-client"
import {
  PlatformMonitorSchema,
  type PlatformMonitor,
} from "@workspace/contracts/platform-monitor"
import { ErrorState, LoadingState, useDocumentTitle } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  createDataTableColumnHelper,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

const column = createDataTableColumnHelper<PlatformMonitor["queues"][number]>()

export function PlatformMonitorPage() {
  const { t } = useTranslation("monitor")
  useDocumentTitle(t("title"))
  const session = useAuthenticatedSession()!
  const query = useQuery({
    queryKey: ["platform", session.user.id, "monitor"],
    queryFn: async ({ signal }) =>
      PlatformMonitorSchema.parse((await getPlatformMonitor({ signal })).data),
    retry: false,
    refetchInterval: 30000,
  })
  usePlatformAccessFailure(query.error)
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <PlatformMonitorView
      data={query.data}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  )
}

export function PlatformMonitorView({
  data,
  refreshing = false,
  onRefresh,
}: {
  data: PlatformMonitor
  refreshing?: boolean
  onRefresh: () => void
}) {
  const { t, i18n } = useTranslation("monitor")
  const number = (value: number | undefined, digits = 0) =>
    value === undefined
      ? "—"
      : new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: digits,
        }).format(value)
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "short",
      timeStyle: "medium",
    }).format(new Date(value))
  const status = (
    value:
      | PlatformMonitor["probes"][number]["status"]
      | PlatformMonitor["worker"]["status"]
      | PlatformMonitor["platformExecutor"]
  ) => (
    <Badge
      variant={
        value === "up" || value === "ready" || value === "running"
          ? "secondary"
          : "outline"
      }
    >
      {t(`status-${value}`)}
    </Badge>
  )
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("scope", {
          header: t("queue"),
          cell: (info) => t(`scope-${info.getValue()}`),
        }),
        column.accessor("status", {
          header: t("state"),
          cell: (info) => t(`status-${info.getValue()}`),
        }),
        ...(
          [
            ["waiting", t("waiting")],
            ["active", t("active")],
            ["delayed", t("delayed")],
            ["failed", t("failed")],
          ] as const
        ).map(([key, label]) =>
          column.accessor(key, {
            header: label,
            cell: (info) => info.getValue() ?? "—",
          })
        ),
      ]),
    [t]
  )
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={refreshing ? "animate-spin" : undefined}
          />
          {t("refresh")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("observationSummary", { value: timestamp(data.observedAt) })}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.probes.map((probe) => (
          <Card key={probe.key} size="sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2 text-sm">
                {t(`dependency-${probe.key}`)}
                {status(probe.status)}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {probe.latencyMs === undefined
                ? t(
                    probe.status === "disabled"
                      ? "storageDisabled"
                      : "requestActive"
                  )
                : t("latency", { value: number(probe.latencyMs, 1) })}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              {t("organizationWorker")}
              {status(data.worker.status)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>{t(`signal-${data.worker.status}`)}</p>
            {data.worker.lastSeenAt && (
              <p>
                {t("lastSeen", { value: timestamp(data.worker.lastSeenAt) })}
              </p>
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              {t("platformExecutor")}
              {status(data.platformExecutor)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {t("executorDescription")}
          </CardContent>
        </Card>
      </div>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 text-sm">
            {t("httpTitle")}
            {status(data.http.status)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.http.status === "ready" ? (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
              {(
                [
                  ["samples", t("samples"), number(data.http.samples)],
                  ["rate", t("rate"), number(data.http.requestsPerSecond, 2)],
                  [
                    "errorRate",
                    t("errorRate"),
                    data.http.errorRate === undefined
                      ? "—"
                      : `${number(data.http.errorRate * 100, 2)}%`,
                  ],
                  [
                    "average",
                    t("average"),
                    t("milliseconds", {
                      value: number(data.http.averageDurationMs, 1),
                    }),
                  ],
                  [
                    "p95",
                    t("p95"),
                    t("milliseconds", {
                      value: number(data.http.p95DurationMs, 1),
                    }),
                  ],
                ] as const
              ).map(([key, label, value]) => (
                <div key={key}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t(`signal-${data.http.status}`)}
            </p>
          )}
        </CardContent>
      </Card>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("queuesTitle")}</h2>
        <DataTable
          data={data.queues}
          columns={columns}
          getRowId={(row) => row.scope}
          showSearch={false}
          showPagination={false}
          enableSorting={false}
          enableRowSelection={false}
        />
      </section>
    </div>
  )
}
