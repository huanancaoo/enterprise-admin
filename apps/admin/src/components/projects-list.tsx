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
  AppShell,
  DataTable,
  DataTableColumnHeader,
  ResourceList,
  TenantSwitcher,
  createDataTableColumnHelper,
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
const statusBadgeVariant = {
  draft: "secondary",
  active: "default",
  archived: "outline",
} as const

type ProjectsListProps = {
  organizationId: string
  organizations: readonly { id: string; name: string }[]
  organizationPending: boolean
  onOrganizationSelect: (organizationId: string) => Promise<boolean>
  search: ProjectListQuery
  onSearchChange: (
    updater: (current: ProjectListQuery) => ProjectListQuery
  ) => void
  onOrganizationChange: (organizationId: string) => void
}

export function ProjectsList({
  organizationId,
  organizations,
  organizationPending,
  onOrganizationSelect,
  search,
  onSearchChange,
  onOrganizationChange,
}: ProjectsListProps) {
  const { t } = useTranslation(["projects", "common"])
  const locale = useUiLocale()
  const query = useQuery(getProjectsListOptions(organizationId, search, locale))
  const columns = useMemo(
    () =>
      columnsHelper.columns([
        columnsHelper.accessor("name", {
          header: t("projects:name"),
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
    [locale, t]
  )
  const columnFilters = search.status
    ? [{ id: "status", value: search.status }]
    : []
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  const page = query.data?.data
  const hasFilters = Boolean(search.name) || search.status !== undefined
  const listStatus = query.isPending
    ? "loading"
    : query.isError
      ? query.error instanceof ApiClientError &&
        query.error.body.code === "FORBIDDEN"
        ? "denied"
        : "error"
      : "ready"

  return (
    <AppShell
      title={t("projects:title")}
      navigation={
        <Link
          to="/app/projects/$organizationId"
          params={{ organizationId }}
          search={search}
          className="block rounded-lg bg-muted p-3 font-medium wrap-anywhere"
        >
          {t("projects:title")}
        </Link>
      }
      workspace={
        <TenantSwitcher
          organizations={organizations}
          organizationId={organizationId}
          disabled={organizationPending}
          onSelect={(nextOrganizationId) => {
            void (async () => {
              if (await onOrganizationSelect(nextOrganizationId)) {
                onOrganizationChange(nextOrganizationId)
              }
            })()
          }}
        />
      }
    >
      <ResourceList
        title={t("projects:title")}
        status={listStatus}
        onRetry={() => void query.refetch()}
        actions={
          <ProjectCreate key={organizationId} organizationId={organizationId} />
        }
      >
        {(listStatus === "loading" || listStatus === "ready") && (
          <DataTable
            columns={columns}
            data={page?.items ?? []}
            getRowId={(row) => row.id}
            rowCount={page?.total ?? 0}
            isLoading={query.isPending}
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
                typeof updater === "function"
                  ? updater(search.name ?? "")
                  : updater
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
                page:
                  next.pageSize === current.pageSize ? next.pageIndex + 1 : 1,
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
              hasFilters ? undefined : (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{t("projects:emptyTitle")}</EmptyTitle>
                    <EmptyDescription>
                      {t("projects:emptyDescription")}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            }
          />
        )}
      </ResourceList>
    </AppShell>
  )
}
