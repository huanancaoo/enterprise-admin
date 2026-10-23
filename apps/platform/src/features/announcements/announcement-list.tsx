import { useMemo, useState, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { FormDialog, AdminPage } from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

import type {
  AnnouncementSummary,
  AnnouncementQuery,
} from "@workspace/contracts/platform-announcements"
export type AnnouncementManagementItem = AnnouncementSummary
export type AnnouncementManagementSearch = AnnouncementQuery
export type AnnouncementPublishValue = {
  target: "platform" | "allTenants" | "organizations"
  organizationIds: string[]
}
const helper = createDataTableColumnHelper<AnnouncementManagementItem>()
function publishSchema(message: string) {
  return z
    .object({
      target: z.enum(["platform", "allTenants", "organizations"]),
      organizationIds: z.array(z.string().min(1)),
    })
    .refine(
      (value) =>
        value.target !== "organizations" || value.organizationIds.length > 0,
      { path: ["organizationIds"], message }
    )
}

export function AnnouncementList({
  items,
  total,
  search,
  onSearchChange,
  status,
  error,
  onRetry,
  onCreate,
  onEdit,
  onView,
  onReaders,
  onPublish,
  onWithdraw,
  onDelete,
  renderOrganizations,
  permissions,
}: {
  items: AnnouncementManagementItem[]
  total: number
  search: AnnouncementManagementSearch
  onSearchChange: (next: AnnouncementManagementSearch) => void
  status: DataTableStatus
  error?: string
  onRetry: () => void
  onCreate: () => void
  onEdit: (id: string) => void
  onView: (id: string) => void
  onReaders: (id: string) => void
  onPublish: (
    id: string,
    value: AnnouncementPublishValue,
    version: number
  ) => Promise<void>
  onWithdraw: (id: string, version: number) => Promise<void>
  onDelete: (id: string, version: number) => Promise<void>
  renderOrganizations: (
    value: string[],
    onChange: (ids: string[]) => void,
    invalid: boolean
  ) => ReactNode
  permissions: readonly string[]
}) {
  const { t } = useTranslation(["announcements", "common"])
  const locale = useUiLocale()
  const canCreate = permissions.includes("platform.announcement:create")
  const canUpdate = permissions.includes("platform.announcement:update")
  const canPublish = permissions.includes("platform.announcement:publish")
  const canDelete = permissions.includes("platform.announcement:delete")
  const canReadReaders = permissions.includes("platform.announcement:readers")
  const [selected, setSelected] = useState<{
    item: AnnouncementManagementItem
    action: "publish" | "withdraw" | "delete"
  } | null>(null)
  const [actionError, setActionError] = useState<string | undefined>()
  const form = useForm({
    defaultValues: {
      target: "platform" as AnnouncementPublishValue["target"],
      organizationIds: [] as string[],
    },
    validators: {
      onSubmit: ({ value }) => {
        if (selected?.action !== "publish") return undefined
        const parsed = publishSchema(t("organizationRequired")).safeParse(value)
        if (parsed.success) return undefined
        return {
          fields: Object.fromEntries(
            parsed.error.issues.map((issue) => [
              issue.path[0],
              { message: issue.message },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      if (!selected) return
      setActionError(undefined)
      try {
        if (selected.action === "publish")
          await onPublish(selected.item.id, value, selected.item.version)
        else if (selected.action === "withdraw")
          await onWithdraw(selected.item.id, selected.item.version)
        else await onDelete(selected.item.id, selected.item.version)
        setSelected(null)
      } catch (cause) {
        setActionError(
          cause instanceof Error ? cause.message : t("common:operationFailed")
        )
      }
    },
  })
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor("title", {
          header: t("subject"),
          cell: ({ row, getValue }) => (
            <Button
              variant="link"
              className="h-auto max-w-full justify-start p-0 text-start whitespace-normal"
              onClick={() => onView(row.original.id)}
            >
              {getValue()}
            </Button>
          ),
          meta: { label: t("subject") },
          size: 360,
        }),
        helper.accessor("type", {
          header: t("type"),
          cell: ({ getValue }) => t(getValue()),
          meta: { label: t("type") },
          size: 100,
        }),
        helper.accessor("status", {
          header: t("status"),
          cell: ({ getValue }) => (
            <Badge variant="secondary">{t(getValue())}</Badge>
          ),
          meta: { label: t("status") },
          size: 110,
        }),
        helper.accessor("updatedAt", {
          header: t("updatedAt"),
          cell: ({ getValue }) =>
            createFormatter(locale).dateTime(new Date(getValue()), "UTC"),
          meta: { label: t("updatedAt") },
          size: 180,
        }),
        helper.display({
          id: "actions",
          header: t("actions"),
          enableHiding: false,
          size: 300,
          cell: ({ row }) => (
            <div className="flex flex-wrap gap-1">
              {canUpdate && row.original.status !== "published" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(row.original.id)}
                >
                  {t("edit")}
                </Button>
              )}
              {canPublish && row.original.status !== "published" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    form.reset()
                    setActionError(undefined)
                    setSelected({ item: row.original, action: "publish" })
                  }}
                >
                  {t("publish")}
                </Button>
              )}
              {canReadReaders && row.original.status === "published" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onReaders(row.original.id)}
                >
                  {t("readers")}
                </Button>
              )}
              {canPublish && row.original.status === "published" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActionError(undefined)
                    setSelected({ item: row.original, action: "withdraw" })
                  }}
                >
                  {t("withdraw")}
                </Button>
              )}
              {canDelete && row.original.status !== "published" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setActionError(undefined)
                    setSelected({ item: row.original, action: "delete" })
                  }}
                >
                  {t("delete")}
                </Button>
              )}
            </div>
          ),
        }),
      ]),
    [
      canUpdate,
      canPublish,
      canDelete,
      canReadReaders,
      form,
      locale,
      onEdit,
      onView,
      onReaders,
      t,
    ]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const labels = {
    draft: t("draft"),
    published: t("published"),
    withdrawn: t("withdrawn"),
  }
  const actionTitle =
    selected?.action === "publish"
      ? t("confirmPublish")
      : selected?.action === "withdraw"
        ? t("confirmWithdraw")
        : t("confirmDelete")
  const actionDescription =
    selected?.action === "publish"
      ? t("publishDescription")
      : selected?.action === "withdraw"
        ? t("withdrawDescription")
        : t("deleteDescription")
  return (
    <AdminPage
      title={t("title")}
      actions={
        <div className="flex gap-2">
          {canCreate && (
            <Button size="sm" onClick={onCreate}>
              {t("new")}
            </Button>
          )}
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={items}
        rowCount={total}
        status={status}
        error={error}
        onRetry={onRetry}
        getRowId={(item) => item.id}
        empty={<p>{t("noAnnouncements")}</p>}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        state={{
          pagination,
          globalFilter: search.q ?? "",
          columnFilters: [
            ...(search.status ? [{ id: "status", value: search.status }] : []),
            ...(search.type ? [{ id: "type", value: search.type }] : []),
          ],
        }}
        searchPlaceholder={t("search")}
        searchMaxLength={200}
        toolbarFilters={
          <div className="flex flex-wrap items-end gap-2">
            <Field className="w-40 gap-1">
              <FieldLabel
                htmlFor="announcement-status-filter"
                className="text-xs text-muted-foreground"
              >
                {t("status")}
              </FieldLabel>
              <Select
                value={search.status ?? "all"}
                items={{ all: t("allStatuses"), ...labels }}
                onValueChange={(value) =>
                  onSearchChange({
                    ...search,
                    page: 1,
                    status:
                      value === "draft" ||
                      value === "published" ||
                      value === "withdrawn"
                        ? value
                        : undefined,
                  })
                }
              >
                <SelectTrigger id="announcement-status-filter" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allStatuses")}</SelectItem>
                  {Object.entries(labels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field className="w-40 gap-1">
              <FieldLabel
                htmlFor="announcement-type-filter"
                className="text-xs text-muted-foreground"
              >
                {t("type")}
              </FieldLabel>
              <Select
                value={search.type ?? "all"}
                items={{
                  all: t("allTypes"),
                  notice: t("notice"),
                  announcement: t("announcement"),
                }}
                onValueChange={(value) =>
                  onSearchChange({
                    ...search,
                    page: 1,
                    type:
                      value === "notice" || value === "announcement"
                        ? value
                        : undefined,
                  })
                }
              >
                <SelectTrigger id="announcement-type-filter" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("allTypes")}</SelectItem>
                  <SelectItem value="notice">{t("notice")}</SelectItem>
                  <SelectItem value="announcement">
                    {t("announcement")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          onSearchChange({ ...search, q: q || undefined, page: 1 })
        }}
        onResetFilters={() =>
          onSearchChange({ page: 1, pageSize: search.pageSize })
        }
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          onSearchChange({
            ...search,
            page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
            pageSize: next.pageSize,
          })
        }}
      />
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <FormDialog
            open={selected !== null}
            onOpenChange={(open) => !pending && !open && setSelected(null)}
            title={actionTitle}
            description={actionDescription}
            pending={pending}
            error={actionError}
            onSubmit={() => void form.handleSubmit()}
            submitLabel={t("confirm")}
          >
            <p className="text-sm font-medium break-words">
              {selected?.item.title}
            </p>
            {selected?.action === "publish" && (
              <FieldGroup>
                <form.Field name="target">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor="announcement-target">
                          {t("target")}
                        </FieldLabel>
                        <Select
                          value={field.state.value}
                          items={{
                            platform: t("platform"),
                            allTenants: t("allTenants"),
                            organizations: t("organizations"),
                          }}
                          onValueChange={(value) => {
                            if (
                              value === "platform" ||
                              value === "allTenants" ||
                              value === "organizations"
                            )
                              field.handleChange(value)
                          }}
                        >
                          <SelectTrigger
                            id="announcement-target"
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="platform">
                              {t("platform")}
                            </SelectItem>
                            <SelectItem value="allTenants">
                              {t("allTenants")}
                            </SelectItem>
                            <SelectItem value="organizations">
                              {t("organizations")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FieldDescription>{t("targetHint")}</FieldDescription>
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Subscribe selector={(state) => state.values.target}>
                  {(target) =>
                    target === "organizations" && (
                      <form.Field name="organizationIds" mode="array">
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          return (
                            <Field data-invalid={invalid}>
                              <FieldLabel>
                                {t("chooseOrganizations")}
                              </FieldLabel>
                              {renderOrganizations(
                                field.state.value,
                                (ids) => {
                                  field.handleChange(ids)
                                  field.handleBlur()
                                },
                                invalid
                              )}
                              {invalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                    )
                  }
                </form.Subscribe>
              </FieldGroup>
            )}
          </FormDialog>
        )}
      </form.Subscribe>
    </AdminPage>
  )
}
