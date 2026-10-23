import { AdminPage } from "@workspace/admin"
import { useCallback, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  listPlatformPosts,
  createPlatformPost,
  updatePlatformPost,
  deletePlatformPost,
  listPlatformDictionaries,
  createPlatformDictionary,
  updatePlatformDictionary,
  deletePlatformDictionary,
  listPlatformDictionaryItems,
  createPlatformDictionaryItem,
  updatePlatformDictionaryItem,
  deletePlatformDictionaryItem,
  listPlatformParameters,
  createPlatformParameter,
  updatePlatformParameter,
  deletePlatformParameter,
  refreshPlatformDictionaryCache,
  refreshPlatformParameterCache,
} from "@workspace/api-client"
import {
  PlatformSystemQuerySchema,
  PlatformDictionaryItemsQuerySchema,
  PlatformPostsPageSchema,
  PlatformDictionariesPageSchema,
  PlatformDictionaryItemsPageSchema,
  PlatformParametersPageSchema,
  CreatePlatformPostSchema,
  CreatePlatformDictionarySchema,
  CreatePlatformDictionaryItemSchema,
  CreatePlatformParameterSchema,
  PlatformSystemRefreshResultSchema,
  type PlatformPost,
  type PlatformDictionary,
  type PlatformDictionaryItem,
  type PlatformParameter,
} from "@workspace/contracts/platform-system"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { PlatformExportButton } from "../tasks/task-actions"
import {
  CatalogDeleteDialog,
  CatalogEditorDialog,
  CatalogStatus,
  type CatalogField,
  type CatalogValues,
} from "./catalog-components"

type CatalogKind = "post" | "dictionary" | "dictionaryItem" | "parameter"
type CatalogRow =
  PlatformPost | PlatformDictionary | PlatformDictionaryItem | PlatformParameter
type CatalogPage = {
  items: CatalogRow[]
  total: number
  page: number
  pageSize: number
}
const columnsHelper = createDataTableColumnHelper<CatalogRow>()
const EMPTY_ROWS: CatalogRow[] = []
const fields = {
  post: ["key", "name"],
  dictionary: ["key", "name", "remark"],
  dictionaryItem: ["value", "label"],
  parameter: ["key", "name", "value", "remark"],
} as const satisfies Record<CatalogKind, readonly CatalogField[]>

function initialValues(row?: CatalogRow): CatalogValues {
  return {
    key: row && "key" in row ? row.key : "",
    name: row && "name" in row ? row.name : "",
    label: row && "label" in row ? row.label : "",
    value: row && "value" in row ? row.value : "",
    remark: row && "remark" in row ? (row.remark ?? "") : "",
    status: row?.status ?? "active",
    sort: row?.sort ?? 0,
  }
}

export function PlatformPostsPage() {
  return <PlatformCatalogPage kind="post" />
}
export function PlatformDictionariesPage() {
  return <PlatformCatalogPage kind="dictionary" />
}
export function PlatformParametersPage() {
  return <PlatformCatalogPage kind="parameter" />
}
export function PlatformDictionaryItemsPage() {
  const { dictionaryId } = useParams({
    from: "/platform/dictionaries/$dictionaryId/items",
  })
  return (
    <PlatformCatalogPage
      key={dictionaryId}
      kind="dictionaryItem"
      dictionaryId={dictionaryId}
    />
  )
}

function PlatformCatalogPage({
  kind,
  dictionaryId,
}: {
  kind: CatalogKind
  dictionaryId?: string
}) {
  const { t } = useTranslation(["catalogs", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const navigate = useNavigate()
  const rawSearch = useSearch({ strict: false })
  const search =
    kind === "dictionaryItem"
      ? PlatformDictionaryItemsQuerySchema.parse(rawSearch)
      : PlatformSystemQuerySchema.parse(rawSearch)
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<CatalogRow | "new" | null>(null)
  const [deleting, setDeleting] = useState<CatalogRow | null>(null)
  const statuses = useMemo(
    () => [
      { value: "active", label: t("catalogs:active") },
      { value: "disabled", label: t("catalogs:disabled") },
    ],
    [t]
  )
  const permissionResource = kind === "dictionaryItem" ? "dictionary" : kind
  const can = useCallback(
    (action: string) =>
      platformAccess.permissions.includes(
        `platform.${permissionResource}:${action}`
      ),
    [platformAccess.permissions, permissionResource]
  )
  const queryKey = [
    "platform",
    session.user.id,
    "system",
    kind,
    dictionaryId,
  ] as const
  const query = useQuery({
    queryKey: [...queryKey, search],
    retry: false,
    queryFn: async ({ signal }): Promise<CatalogPage> => {
      switch (kind) {
        case "post":
          return PlatformPostsPageSchema.parse(
            (
              await listPlatformPosts(PlatformSystemQuerySchema.parse(search), {
                signal,
              })
            ).data
          )
        case "dictionary":
          return PlatformDictionariesPageSchema.parse(
            (
              await listPlatformDictionaries(
                PlatformSystemQuerySchema.parse(search),
                { signal }
              )
            ).data
          )
        case "dictionaryItem":
          return PlatformDictionaryItemsPageSchema.parse(
            (
              await listPlatformDictionaryItems(
                dictionaryId!,
                PlatformDictionaryItemsQuerySchema.parse(search),
                { signal }
              )
            ).data
          )
        case "parameter":
          return PlatformParametersPageSchema.parse(
            (
              await listPlatformParameters(
                PlatformSystemQuerySchema.parse(search),
                { signal }
              )
            ).data
          )
      }
    },
  })
  const rejectAccess = usePlatformAccessFailure(query.error)
  const refresh = useMutation({
    mutationFn: async () =>
      PlatformSystemRefreshResultSchema.parse(
        (
          await (kind === "parameter"
            ? refreshPlatformParameterCache()
            : refreshPlatformDictionaryCache())
        ).data
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["platform", session.user.id, "system", kind],
      })
    },
    onError: (error) => void rejectAccess(error),
  })
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }
  const save = async (value: CatalogValues) => {
    const base = {
      key: value.key,
      name: value.name,
      status: value.status,
      sort: value.sort,
    }
    const row = editing === "new" ? null : editing
    switch (kind) {
      case "post": {
        const body = CreatePlatformPostSchema.parse(base)
        if (row) await updatePlatformPost(row.id, body)
        else await createPlatformPost(body)
        break
      }
      case "dictionary": {
        const body = CreatePlatformDictionarySchema.parse({
          ...base,
          remark: value.remark || null,
        })
        if (row) await updatePlatformDictionary(row.id, body)
        else await createPlatformDictionary(body)
        break
      }
      case "dictionaryItem": {
        const body = CreatePlatformDictionaryItemSchema.parse({
          value: value.value,
          label: value.label,
          status: value.status,
          sort: value.sort,
        })
        if (row) await updatePlatformDictionaryItem(dictionaryId!, row.id, body)
        else await createPlatformDictionaryItem(dictionaryId!, body)
        break
      }
      case "parameter": {
        const body = CreatePlatformParameterSchema.parse({
          ...base,
          value: value.value,
          remark: value.remark || null,
        })
        if (row) await updatePlatformParameter(row.id, body)
        else await createPlatformParameter(body)
        break
      }
    }
    await invalidate()
  }
  const remove = async (row: CatalogRow) => {
    switch (kind) {
      case "post":
        await deletePlatformPost(row.id)
        break
      case "dictionary":
        await deletePlatformDictionary(row.id)
        break
      case "dictionaryItem":
        await deletePlatformDictionaryItem(dictionaryId!, row.id)
        break
      case "parameter":
        await deletePlatformParameter(row.id)
        break
    }
    await invalidate()
  }
  const columns = useMemo(
    () =>
      columnsHelper.columns([
        columnsHelper.accessor((row) => ("key" in row ? row.key : row.value), {
          id: kind === "dictionaryItem" ? "value" : "key",
          header: ({ header }) => (
            <DataTableColumnHeader
              header={header}
              title={
                kind === "dictionaryItem"
                  ? t("catalogs:value")
                  : t("catalogs:key")
              }
            />
          ),
          cell: ({ getValue }) => (
            <bdi className="font-mono text-xs">{getValue()}</bdi>
          ),
          size: 220,
          meta: {
            label:
              kind === "dictionaryItem"
                ? t("catalogs:value")
                : t("catalogs:key"),
          },
        }),
        columnsHelper.accessor(
          (row) => ("name" in row ? row.name : row.label),
          {
            id: kind === "dictionaryItem" ? "label" : "name",
            header: ({ header }) => (
              <DataTableColumnHeader
                header={header}
                title={
                  kind === "dictionaryItem"
                    ? t("catalogs:label")
                    : t("catalogs:name")
                }
              />
            ),
            cell: ({ row, getValue }) =>
              kind === "dictionary" ? (
                <Link
                  to="/platform/dictionaries/$dictionaryId/items"
                  params={{ dictionaryId: row.original.id }}
                  search={PlatformDictionaryItemsQuerySchema.parse({})}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {getValue()}
                </Link>
              ) : (
                <span className="font-medium">{getValue()}</span>
              ),
            size: 220,
            meta: {
              label:
                kind === "dictionaryItem"
                  ? t("catalogs:label")
                  : t("catalogs:name"),
            },
          }
        ),
        ...(kind === "parameter"
          ? [
              columnsHelper.accessor(
                (row) => ("value" in row ? row.value : ""),
                {
                  id: "parameterValue",
                  header: t("catalogs:value"),
                  cell: ({ getValue }) => (
                    <span className="line-clamp-2 wrap-anywhere">
                      {getValue()}
                    </span>
                  ),
                  size: 280,
                  meta: { label: t("catalogs:value") },
                }
              ),
            ]
          : []),
        columnsHelper.accessor("status", {
          header: t("catalogs:status"),
          cell: ({ getValue }) => (
            <CatalogStatus value={getValue()} statuses={statuses} />
          ),
          enableSorting: false,
          meta: {
            label: t("catalogs:status"),
            facetMode: "single",
            facetOptions: statuses,
          },
        }),
        columnsHelper.accessor("sort", {
          header: ({ header }) => (
            <DataTableColumnHeader header={header} title={t("catalogs:sort")} />
          ),
          meta: { label: t("catalogs:sort") },
          size: 90,
        }),
        ...(kind === "dictionary" || kind === "parameter"
          ? [
              columnsHelper.accessor(
                (row) => ("remark" in row ? row.remark : null),
                {
                  id: "remark",
                  header: t("catalogs:remark"),
                  cell: ({ getValue }) => (
                    <span className="line-clamp-2">{getValue() || "—"}</span>
                  ),
                  enableSorting: false,
                  meta: { label: t("catalogs:remark") },
                }
              ),
            ]
          : []),
        columnsHelper.display({
          id: "actions",
          header: t("catalogs:actions"),
          enableHiding: false,
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              {can("update") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(row.original)}
                >
                  {t("catalogs:edit")}
                </Button>
              )}
              {can("delete") && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setDeleting(row.original)}
                >
                  {t("catalogs:delete")}
                </Button>
              )}
            </div>
          ),
          meta: { label: t("catalogs:actions") },
          size: 150,
        }),
      ]),
    [can, kind, statuses, t]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const filters = search.status ? [{ id: "status", value: search.status }] : []
  const tableStatus = getDataTableQueryStatus(query)
  const changeSearch = (patch: Record<string, unknown>) => {
    if (kind === "dictionaryItem") {
      void navigate({
        to: "/platform/dictionaries/$dictionaryId/items",
        params: { dictionaryId: dictionaryId! },
        search: PlatformDictionaryItemsQuerySchema.parse({
          ...search,
          ...patch,
        }),
      })
    } else {
      const next = PlatformSystemQuerySchema.parse({ ...search, ...patch })
      if (kind === "post")
        void navigate({ to: "/platform/posts", search: next })
      else if (kind === "dictionary")
        void navigate({ to: "/platform/dictionaries", search: next })
      else void navigate({ to: "/platform/parameters", search: next })
    }
  }
  return (
    <AdminPage
      actions={
        tableStatus !== "forbidden" &&
        can("create") && (
          <Button onClick={() => setEditing("new")}>
            {t("catalogs:create")}
          </Button>
        )
      }
      title={t(`catalogs:${kind}Title`)}
      description={t(`catalogs:${kind}Description`)}
      back={
        kind === "dictionaryItem" && (
          <Link
            to="/platform/dictionaries"
            search={PlatformSystemQuerySchema.parse({})}
            className="text-sm text-muted-foreground hover:underline"
          >
            {t("catalogs:backToDictionaries")}
          </Link>
        )
      }
    >
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_ROWS}
        getRowId={(row) => row.id}
        rowCount={query.data?.total ?? 0}
        status={tableStatus}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableRowSelection={false}
        searchPlaceholder={
          kind === "dictionaryItem"
            ? t("catalogs:searchItems")
            : t("catalogs:search")
        }
        searchMaxLength={200}
        toolbarActions={
          <>
            {can("export") && (
              <PlatformExportButton
                resource={kind}
                filters={search}
                dictionaryId={dictionaryId}
              />
            )}
            {(kind === "dictionary" || kind === "parameter") &&
              can("refresh") && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={refresh.isPending}
                  onClick={() => refresh.mutate()}
                >
                  {t("catalogs:refreshCache")}
                </Button>
              )}
          </>
        }
        state={{
          pagination,
          globalFilter: search.q ?? "",
          columnFilters: filters,
          sorting: [{ id: search.sortBy, desc: search.sortOrder === "desc" }],
        }}
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          changeSearch({ q: q || undefined, page: 1 })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(filters) : updater
          changeSearch({
            status: next.find((filter) => filter.id === "status")?.value,
            page: 1,
          })
        }}
        onSortingChange={(updater) => {
          const current = [
            { id: search.sortBy, desc: search.sortOrder === "desc" },
          ]
          const next =
            typeof updater === "function" ? updater(current) : updater
          changeSearch({
            sortBy: next[0]?.id ?? "sort",
            sortOrder: next[0]?.desc ? "desc" : "asc",
            page: 1,
          })
        }}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          changeSearch({
            page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
            pageSize: next.pageSize,
          })
        }}
        onResetFilters={() =>
          changeSearch({ q: undefined, status: undefined, page: 1 })
        }
      />
      {refresh.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("catalogs:cacheRefreshed")}
        </p>
      )}
      {refresh.isError && (
        <p role="alert" className="text-sm text-destructive">
          {refresh.error instanceof Error
            ? refresh.error.message
            : t("common:operationFailed")}
        </p>
      )}
      {editing !== null && (
        <CatalogEditorDialog
          key={editing === "new" ? "new" : editing.id}
          title={editing === "new" ? t("catalogs:create") : t("catalogs:edit")}
          fields={fields[kind]}
          allowEmptyValue={kind === "parameter"}
          initial={initialValues(editing === "new" ? undefined : editing)}
          statuses={statuses}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
      {deleting !== null && (
        <CatalogDeleteDialog
          name={"name" in deleting ? deleting.name : deleting.label}
          onClose={() => setDeleting(null)}
          onDelete={() => remove(deleting)}
        />
      )}
    </AdminPage>
  )
}
