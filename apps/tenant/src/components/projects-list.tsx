import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { ApiClientError, getProjectsListOptions } from "@workspace/api-client"
import {
  ProjectStatusSchema,
  type ProjectListQuery,
  type ProjectResponse,
} from "@workspace/contracts"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import {
  DataTable,
  DataTableColumnHeader,
  ResourceList,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin"
import { Badge } from "@workspace/ui/components/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"

import { ProjectCreate } from "./project-create"

const columnsHelper = createDataTableColumnHelper<ProjectResponse>()
const EMPTY_PROJECTS: ProjectResponse[] = []
const statusBadgeVariant = {
  draft: "secondary",
  active: "default",
  archived: "outline",
} as const

type ProjectsListProps = {
  organizationId: string
  search: ProjectListQuery
  onSearchChange: (
    updater: (current: ProjectListQuery) => ProjectListQuery
  ) => void
}

export function ProjectsList({
  organizationId,
  search,
  onSearchChange,
}: ProjectsListProps) {
  const { t } = useTranslation(["projects", "common", "organization"])
  const locale = useUiLocale()
  const query = useQuery(getProjectsListOptions(organizationId, search, locale))
  const columns = useMemo(
    () =>
      columnsHelper.columns([
        columnsHelper.accessor("name", {
          header: t("projects:name"),
          cell: (cell) => (
            <Link
              to="/app/projects/$organizationId/$projectId"
              params={{ organizationId, projectId: cell.row.original.id }}
              className="font-medium underline-offset-4 hover:underline"
            >
              {cell.getValue()}
            </Link>
          ),
          meta: { label: t("projects:name") },
          size: 320,
          enableSorting: false,
        }),
        columnsHelper.accessor("status", {
          header: t("projects:status"),
          cell: (cell) => {
            const status = cell.getValue()
            return (
              <Badge variant={statusBadgeVariant[status]}>
                {t(`projects:${status}`)}
              </Badge>
            )
          },
          meta: {
            label: t("projects:status"),
            facetMode: "single",
            facetOptions: [
              { label: t("projects:draft"), value: "draft" },
              { label: t("projects:active"), value: "active" },
              { label: t("projects:archived"), value: "archived" },
            ],
          },
          enableSorting: false,
        }),
        columnsHelper.accessor("createdAt", {
          header: ({ header }) => (
            <DataTableColumnHeader
              header={header}
              title={t("projects:createdAt")}
            />
          ),
          cell: (cell) =>
            createFormatter(locale).dateTime(new Date(cell.getValue()), "UTC"),
          meta: { label: t("projects:createdAt") },
        }),
        columnsHelper.accessor("updatedAt", {
          header: ({ header }) => (
            <DataTableColumnHeader
              header={header}
              title={t("projects:updatedAt")}
            />
          ),
          cell: (cell) =>
            createFormatter(locale).dateTime(new Date(cell.getValue()), "UTC"),
          meta: { label: t("projects:updatedAt") },
        }),
      ]),
    [locale, organizationId, t]
  )
  const columnFilters = search.status
    ? [{ id: "status", value: search.status }]
    : []
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  const page = query.data?.data
  const tableStatus: DataTableStatus =
    query.isError &&
    query.error instanceof ApiClientError &&
    query.error.body.code === "FORBIDDEN"
      ? "forbidden"
      : query.isPending
        ? "loading"
        : query.isFetching
          ? "refreshing"
          : query.isError
            ? "error"
            : "ready"

  return (
    <ResourceList
      title={t("projects:title")}
      status="ready"
      actions={
        <ProjectCreate key={organizationId} organizationId={organizationId} />
      }
    >
      <DataTable
        key={organizationId}
        columns={columns}
        data={page?.items ?? EMPTY_PROJECTS}
        getRowId={(row) => row.id}
        rowCount={page?.total ?? 0}
        status={tableStatus}
        onRetry={() => void query.refetch()}
        onResetFilters={() =>
          onSearchChange((current) => ({
            ...current,
            page: 1,
            name: undefined,
            status: undefined,
          }))
        }
        manualPagination
        manualFiltering
        manualSorting
        enableMultiSort={false}
        searchPlaceholder={t("projects:searchPlaceholder")}
        state={{
          globalFilter: search.name ?? "",
          columnFilters,
          pagination: {
            pageIndex: search.page - 1,
            pageSize: search.pageSize,
          },
          sorting,
        }}
        onGlobalFilterChange={(updater) => {
          const value =
            typeof updater === "function" ? updater(search.name ?? "") : updater
          const name = typeof value === "string" ? value.trim() : ""
          onSearchChange((current) => ({
            ...current,
            page: 1,
            name: name || undefined,
          }))
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const value = next.find((filter) => filter.id === "status")?.value
          onSearchChange((current) => ({
            ...current,
            page: 1,
            status:
              value === undefined
                ? undefined
                : ProjectStatusSchema.parse(value),
          }))
        }}
        onPaginationChange={(updater) => {
          const previous = {
            pageIndex: search.page - 1,
            pageSize: search.pageSize,
          }
          const next =
            typeof updater === "function" ? updater(previous) : updater
          onSearchChange((current) => ({
            ...current,
            page: next.pageSize === current.pageSize ? next.pageIndex + 1 : 1,
            pageSize: next.pageSize,
          }))
        }}
        onSortingChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(sorting) : updater
          const sort = next[0]
          onSearchChange((current) => ({
            ...current,
            page: 1,
            sortBy: sort?.id === "updatedAt" ? "updatedAt" : "createdAt",
            sortOrder:
              sort?.id === undefined ? "desc" : sort.desc ? "desc" : "asc",
          }))
        }}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t("projects:emptyTitle")}</EmptyTitle>
              <EmptyDescription>
                {t("projects:emptyDescription")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
      />
    </ResourceList>
  )
}
