import { taskCenterKeys, taskIsActive } from "./task-queries"
import { useEffect, useMemo } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  PageHeader,
  LoadingState,
  ErrorState,
  EmptyState,
  Pagination,
} from "@workspace/admin"
import { listTaskCenter, requestLanguageHeader } from "@workspace/api-client"
import { useOrganizationAuthorization } from "@/hooks/use-organization-authorization"
import { TaskCenterPageSchema } from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Badge } from "@workspace/ui/components/badge"
import { TaskDetails } from "./task-details"
import type { TaskCenterSearch, TaskCenterItem } from "./task-center-search"

export function TaskCenter({
  organizationId,
  search,
  onSearchChange,
}: {
  organizationId: string
  search: TaskCenterSearch
  onSearchChange: (search: TaskCenterSearch) => void
}) {
  const { t } = useTranslation(["tasks", "files", "common"])
  const user = useAuthenticatedSession()!.user
  const locale = useUiLocale()
  const format = useMemo(() => createFormatter(locale), [locale])
  const client = useQueryClient()
  const access = useOrganizationAuthorization({
    organizationId,
    userId: user.id,
    observation: "task-center",
  })
  const version = access.data?.authorizationVersion ?? 0
  const prefix = taskCenterKeys.scope(organizationId, user.id)
  const query = useQuery({
    queryKey: [...prefix, version, locale, search.page, search.pageSize],
    retry: false,
    enabled: access.isSuccess && !access.isFetching,
    queryFn: async ({ signal }) =>
      TaskCenterPageSchema.parse(
        (
          await listTaskCenter(
            organizationId,
            { page: search.page, pageSize: search.pageSize },
            { signal, headers: { [requestLanguageHeader]: locale } }
          )
        ).data
      ),
    refetchInterval: (q) =>
      q.state.error
        ? false
        : q.state.data?.items.some(
              (item) =>
                taskIsActive(item.status) ||
                item.states?.some((part) => taskIsActive(part.state))
            )
          ? 1000
          : false,
  })
  useEffect(() => {
    if (!version) return
    // 组织级结果绑定实时授权版本；角色降级后不能把旧allorg缓存当成本人结果。
    const filter = {
      queryKey: taskCenterKeys.scope(organizationId, user.id),
      predicate: (q: { queryKey: readonly unknown[] }) =>
        q.queryKey[4] !== version,
    }
    void client.cancelQueries(filter)
    client.removeQueries(filter)
  }, [client, organizationId, user.id, version])
  const states = {
    submitted: t("tasks:submitted"),
    queued: t("tasks:queued"),
    running: t("tasks:running"),
    completed: t("tasks:completed"),
    failed: t("tasks:failed"),
    rejected: t("tasks:rejected"),
    pending: t("files:batchPending"),
    preparing: t("files:batchPreparing"),
    committed: t("files:batchCommitted"),
    cleaning: t("files:batchCleaning"),
    covered: t("files:batchCovered"),
    unavailable: t("files:batchUnavailable"),
  }
  const types: Record<string, string> = {
    "projects.import": t("tasks:importProjects"),
    "projects.export": t("tasks:exportProjects"),
    upload: t("tasks:fileUpload"),
    overwrite: t("tasks:fileOverwrite"),
    "create-folder": t("tasks:createFolder"),
    rename: t("tasks:rename"),
    move: t("tasks:move"),
    trash: t("tasks:trash"),
    restore: t("tasks:restore"),
    purge: t("tasks:purge"),
  }
  const stateLabel = (state: string) => states[state as keyof typeof states]
  const sources = {
    business: t("tasks:business"),
    "file-upload": t("tasks:fileUpload"),
    "file-path": t("tasks:fileOperation"),
    "file-batch": t("tasks:fileBatch"),
  }
  const open = (item: TaskCenterItem) =>
    onSearchChange({ ...search, source: item.source, taskId: item.id })
  const close = () =>
    onSearchChange({ ...search, source: undefined, taskId: undefined })
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("tasks:title")}
        actions={
          <Button
            variant="outline"
            disabled={access.isFetching}
            onClick={() => {
              void access
                .refetch()
                .then(() => client.invalidateQueries({ queryKey: prefix }))
            }}
          >
            {t("tasks:refresh")}
          </Button>
        }
      />
      {access.isError ? (
        <ErrorState
          message={access.error.message}
          onRetry={() => void access.refetch()}
        />
      ) : access.isPending || access.isFetching ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <LoadingState />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {query.data.visibility === "own"
              ? t("tasks:myTasks")
              : t("tasks:organizationTasks")}
          </p>
          {query.data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("tasks:task")}</TableHead>
                    <TableHead>{t("tasks:source")}</TableHead>
                    <TableHead>{t("tasks:status")}</TableHead>
                    <TableHead>{t("tasks:actor")}</TableHead>
                    <TableHead>{t("tasks:createdAt")}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t("tasks:details")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((item) => (
                    <TableRow key={`${item.source}:${item.id}`}>
                      <TableCell>{types[item.type]}</TableCell>
                      <TableCell>{sources[item.source]}</TableCell>
                      <TableCell>
                        {item.status ? (
                          <Badge variant="secondary">
                            {stateLabel(item.status)}
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {item.states?.map((part) => (
                              <Badge key={part.state} variant="outline">
                                {stateLabel(part.state)} ·{" "}
                                {format.number(part.count)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-36 break-all">
                        {item.actorId === user.id
                          ? t("tasks:me")
                          : item.actorId}
                      </TableCell>
                      <TableCell>
                        {format.dateTime(new Date(item.createdAt), "UTC")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => open(item)}
                        >
                          {t("tasks:viewTask")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination
            pageIndex={search.page - 1}
            pageSize={search.pageSize}
            rowCount={query.data.total}
            pageCount={Math.max(
              1,
              Math.ceil(query.data.total / search.pageSize)
            )}
            onPageChange={(index) =>
              onSearchChange({ ...search, page: index + 1 })
            }
            onPageSizeChange={(pageSize) =>
              onSearchChange({ ...search, page: 1, pageSize })
            }
          />
          {search.source && search.taskId && (
            <TaskDetails
              key={`${access.data.scopeKey}:${search.source}:${search.taskId}`}
              organizationId={organizationId}
              source={search.source}
              taskId={search.taskId}
              authorizationVersion={version}
              onClose={close}
            />
          )}
        </>
      )}
    </div>
  )
}
