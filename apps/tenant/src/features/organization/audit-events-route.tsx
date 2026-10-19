import {
  getOrganizationAuditEventOptions,
  getOrganizationAuditEventsOptions,
} from "@/features/organization/organization-audit"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { PageHeader } from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
  getDataTableQueryStatus,
} from "@workspace/admin/data-table"
import { ApiClientError } from "@workspace/api-client"
import {
  AuditEventsQuerySchema,
  type AuditEvent,
  type AuditEventsQuery,
} from "@workspace/contracts"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { XIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import { TenantExportButton } from "../tasks/tenant-export-button"
import { MemberCombobox } from "./member-combobox"

const auditPath = "/app/organizations/$organizationId/audit"

function createFilterSchema(
  messages: {
    invalidDate: string
    invalidId: string
    invalidDateRange: string
    rangeTooLong: string
  },
  window: Pick<AuditEventsQuery, "from" | "to">
) {
  const dateValue = z
    .string()
    .refine(
      (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
      messages.invalidDate
    )
  const uuidValue = z
    .string()
    .refine(
      (value) => !value || z.uuid().safeParse(value).success,
      messages.invalidId
    )
  return z
    .object({
      from: dateValue,
      to: dateValue,
      actorId: uuidValue,
      resourceType: z.string().max(80),
      resourceId: uuidValue,
    })
    .superRefine((value, context) => {
      if (value.from && value.to && value.from > value.to)
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: messages.invalidDateRange,
        })
      const from =
        value.from === window.from?.slice(0, 10)
          ? window.from
          : value.from && `${value.from}T00:00:00.000Z`
      const to =
        value.to === window.to?.slice(0, 10)
          ? window.to
          : value.to && dateEnd(value.to)
      if (
        from &&
        to &&
        Date.parse(to) - Date.parse(from) > 90 * 24 * 60 * 60 * 1000
      )
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: messages.rangeTooLong,
        })
    })
}

function dateStart(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : undefined
}

function dateEnd(value: string) {
  if (!value) return undefined

  const endOfDay = new Date(`${value}T23:59:59.999Z`)
  const now = new Date()
  return (
    value === now.toISOString().slice(0, 10) ? now : endOfDay
  ).toISOString()
}

function eventLabel(event: AuditEvent, labels: Record<string, string>) {
  return labels[event.eventCode] ?? event.eventCode
}

function EventMetadata({ event }: { event: AuditEvent }) {
  return (
    <dl className="grid gap-4 rounded-lg bg-muted/30 p-4 text-sm sm:grid-cols-2">
      {Object.entries(event.metadata).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-sm text-muted-foreground">{key}</dt>
          <dd dir="auto" className="text-sm break-words">
            {typeof value === "string" ? value : JSON.stringify(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const auditColumns = createDataTableColumnHelper<AuditEvent>()
const EMPTY_EVENTS: AuditEvent[] = []
const advancedNames = [
  "from",
  "to",
  "actorId",
  "resourceType",
  "resourceId",
] as const
const advancedLabels = {
  from: "auditFrom",
  to: "auditTo",
  actorId: "auditActor",
  resourceType: "auditResourceType",
  resourceId: "auditResourceId",
} as const

function AuditFilters({
  organizationId,
  search,
  loading,
  onApply,
}: {
  organizationId: string
  search: AuditEventsQuery
  loading: boolean
  onApply: (search: AuditEventsQuery) => Promise<void>
}) {
  const { t } = useTranslation(["organization", "common"])
  const initialFrom = search.from?.slice(0, 10) ?? ""
  const initialTo = search.to?.slice(0, 10) ?? ""
  const schema = useMemo(
    () =>
      createFilterSchema(
        {
          invalidDate: t("organization:auditInvalidDate"),
          invalidId: t("organization:auditInvalidId"),
          invalidDateRange: t("organization:auditInvalidDateRange"),
          rangeTooLong: t("organization:auditRangeTooLong"),
        },
        search
      ),
    [search, t]
  )
  const filters = useForm({
    defaultValues: {
      from: initialFrom,
      to: initialTo,
      actorId: search.actorId ?? "",
      resourceType: search.resourceType ?? "",
      resourceId: search.resourceId ?? "",
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      await onApply({
        ...search,
        // 日期控件只编辑到天；未改动的窗口继续保留服务端返回的微秒边界。
        from: value.from === initialFrom ? search.from : dateStart(value.from),
        to: value.to === initialTo ? search.to : dateEnd(value.to),
        actorId: value.actorId.trim() || undefined,
        resourceType: value.resourceType.trim() || undefined,
        resourceId: value.resourceId.trim() || undefined,
        page: 1,
      })
    },
  })
  return (
    <filters.Subscribe selector={(state) => state.isSubmitting}>
      {(busy) => (
        <form
          className="basis-full"
          noValidate
          aria-busy={busy || loading}
          onSubmit={(event) => {
            event.preventDefault()
            void filters.handleSubmit()
          }}
        >
          <fieldset disabled={busy || loading} className="min-w-0">
            <FieldGroup className="flex-row flex-wrap items-end gap-2">
              {advancedNames.map((name) => (
                <filters.Field key={name} name={name}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field
                        className={
                          name === "actorId"
                            ? "w-48 max-w-full shrink-0 gap-1.5"
                            : name === "from" || name === "to"
                              ? "w-36 max-w-full shrink-0 gap-1.5"
                              : "w-44 max-w-full shrink-0 gap-1.5"
                        }
                        data-invalid={invalid}
                      >
                        <FieldLabel htmlFor={`tenant-audit-${name}`}>
                          {t(`organization:${advancedLabels[name]}`)}
                        </FieldLabel>
                        {name === "actorId" ? (
                          <MemberCombobox
                            organizationId={organizationId}
                            id={`tenant-audit-${name}`}
                            invalid={invalid}
                            value={field.state.value || null}
                            onValueChange={(value) =>
                              field.handleChange(value ?? "")
                            }
                            onBlur={field.handleBlur}
                            disabled={busy || loading}
                          />
                        ) : (
                          <Input
                            id={`tenant-audit-${name}`}
                            type={
                              name === "from" || name === "to" ? "date" : "text"
                            }
                            autoComplete="off"
                            aria-invalid={invalid}
                            value={field.state.value}
                            maxLength={name === "resourceType" ? 80 : 36}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                          />
                        )}
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </filters.Field>
              ))}
              <Button type="submit" className="self-end">
                {t("organization:applyAuditFilters")}
              </Button>
            </FieldGroup>
          </fieldset>
        </form>
      )}
    </filters.Subscribe>
  )
}

function AuditWorkspace({
  organizationId,
  search,
}: {
  organizationId: string
  search: AuditEventsQuery
}) {
  const navigate = useNavigate({ from: auditPath })
  const { t } = useTranslation(["organization", "common"])
  const locale = useUiLocale()
  const eventLabels = useMemo(
    () => ({
      "invitation.delivery_smtp_accepted": t(
        "organization:delivery_smtp_accepted"
      ),
      "invitation.delivery_failed": t("organization:delivery_failed"),
      "invitation.delivery_unknown": t("organization:delivery_unknown"),
      "invitation.accepted": t("organization:audit_event_invitation_accepted"),
      "invitation.canceled": t("organization:audit_event_invitation_canceled"),
      "invitation.rejected": t("organization:audit_event_invitation_rejected"),
      "invitation.resent": t("organization:audit_event_invitation_resent"),
      "member.invited": t("organization:audit_event_member_invited"),
      "member.left": t("organization:audit_event_member_left"),
      "member.removed": t("organization:audit_event_member_removed"),
      "member.role_changed": t("organization:audit_event_member_role_changed"),
      "organization.settings_updated": t(
        "organization:audit_event_organization_settings_updated"
      ),
      "role.created": t("organization:audit_event_role_created"),
      "role.updated": t("organization:audit_event_role_updated"),
      "role.deleted": t("organization:audit_event_role_deleted"),
      "platform.organization_resumed": t(
        "organization:audit_event_platform_organization_resumed"
      ),
      "platform.organization_suspended": t(
        "organization:audit_event_platform_organization_suspended"
      ),
      "project.created": t("organization:audit_event_project_created"),
      "project.deleted": t("organization:audit_event_project_deleted"),
      "project.translation.updated": t(
        "organization:audit_event_project_translation_updated"
      ),
      "project.updated": t("organization:audit_event_project_updated"),
    }),
    [t]
  )
  const actorLabels = useMemo(
    () => ({
      deployment_operator: t("organization:auditActor_deployment_operator"),
      system: t("organization:auditActor_system"),
      user: t("organization:auditActor_user"),
    }),
    [t]
  )
  const resultLabels = useMemo(
    () => ({
      denied: t("organization:audit_result_denied"),
      failed: t("organization:audit_result_failed"),
      no_change: t("organization:audit_result_no_change"),
      succeeded: t("organization:audit_result_succeeded"),
    }),
    [t]
  )
  const [selectedEventId, setSelectedEventId] = useState("")
  const page = useQuery(
    getOrganizationAuditEventsOptions(organizationId, search)
  )
  const details = useQuery(
    getOrganizationAuditEventOptions(organizationId, selectedEventId)
  )
  const columns = useMemo(
    () =>
      auditColumns.columns([
        auditColumns.accessor("occurredAt", {
          header: t("organization:auditOccurredAt"),
          cell: ({ getValue }) =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "UTC",
            }).format(new Date(getValue())),
          meta: { label: t("organization:auditOccurredAt") },
          size: 210,
        }),
        auditColumns.accessor("eventCode", {
          header: t("organization:auditEventCode"),
          cell: ({ row }) => (
            <div>
              <Button
                variant="link"
                className="h-auto justify-start p-0 text-start leading-relaxed wrap-anywhere whitespace-normal"
                onClick={() => setSelectedEventId(row.original.id)}
              >
                {eventLabel(row.original, eventLabels)}
              </Button>
              {row.original.scope === "platform" && (
                <span className="ms-2 text-xs text-muted-foreground">
                  {t("organization:auditPlatform")}
                </span>
              )}
            </div>
          ),
          meta: { label: t("organization:auditEventCode") },
          size: 270,
        }),
        auditColumns.accessor("actorId", {
          header: t("organization:auditActor"),
          cell: ({ row }) => (
            <bdi className="text-xs wrap-anywhere text-muted-foreground">
              {row.original.actorId ?? actorLabels[row.original.actorType]}
            </bdi>
          ),
          meta: { label: t("organization:auditActor") },
          size: 260,
        }),
        auditColumns.accessor("resourceType", {
          header: t("organization:auditResourceType"),
          cell: ({ getValue }) => (
            <bdi className="wrap-anywhere">{getValue() ?? "—"}</bdi>
          ),
          meta: { label: t("organization:auditResourceType") },
          size: 180,
        }),
        auditColumns.accessor("result", {
          header: t("organization:auditResult"),
          cell: ({ getValue }) => (
            <Badge
              variant={getValue() === "succeeded" ? "secondary" : "outline"}
            >
              {resultLabels[getValue()]}
            </Badge>
          ),
          meta: {
            label: t("organization:auditResult"),
            facetMode: "single",
            facetOptions: (
              ["succeeded", "denied", "failed", "no_change"] as const
            ).map((value) => ({ value, label: resultLabels[value] })),
          },
        }),
      ]),
    [actorLabels, eventLabels, locale, resultLabels, t]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  const columnFilters = [
    ...(search.result ? [{ id: "result", value: search.result }] : []),
    ...(search.actorId ? [{ id: "actorId", value: search.actorId }] : []),
    ...(search.resourceType || search.resourceId
      ? [
          {
            id: "resourceType",
            value: { type: search.resourceType, id: search.resourceId },
          },
        ]
      : []),
    ...(search.from || search.to
      ? [{ id: "occurredAt", value: { from: search.from, to: search.to } }]
      : []),
  ]
  const accessDenied =
    page.isError &&
    page.error instanceof ApiClientError &&
    (page.error.status === 401 || page.error.status === 403)
  const status = getDataTableQueryStatus(page)
  function resultLabel(result: string) {
    return resultLabels[result as keyof typeof resultLabels] ?? result
  }

  return (
    <section className="min-w-0 space-y-6">
      <PageHeader
        title={t("organization:audit")}
        description={t("organization:auditDescription")}
      />

      <DataTable
        columns={columns}
        data={accessDenied ? EMPTY_EVENTS : (page.data?.items ?? EMPTY_EVENTS)}
        getRowId={(row) => row.id}
        rowCount={accessDenied ? 0 : (page.data?.total ?? 0)}
        status={status}
        error={page.isError ? t("organization:auditError") : undefined}
        onRetry={() => void page.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        searchPlaceholder={t("organization:auditSearchPlaceholder")}
        searchMaxLength={120}
        state={{
          pagination,
          globalFilter: search.eventCode ?? "",
          columnFilters,
        }}
        toolbarContent={
          <TenantExportButton
            organizationId={organizationId}
            resource="audit"
            filters={page.data ? { ...search, ...page.data.window } : null}
          />
        }
        toolbarFilters={
          <AuditFilters
            organizationId={organizationId}
            key={JSON.stringify(search)}
            search={search}
            loading={page.isFetching}
            onApply={(next) => navigate({ search: next })}
          />
        }
        onGlobalFilterChange={(updater) => {
          const value =
            typeof updater === "function"
              ? updater(search.eventCode ?? "")
              : updater
          void navigate({
            search: { ...search, page: 1, eventCode: value || undefined },
          })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const result = AuditEventsQuerySchema.shape.result.parse(
            next.find((filter) => filter.id === "result")?.value
          )
          void navigate({ search: { ...search, page: 1, result } })
        }}
        onResetFilters={() =>
          void navigate({ search: { page: 1, pageSize: search.pageSize } })
        }
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          // 翻页沿用服务端确定的时间窗口，查询条件变化时则回到第一页。
          void navigate({
            search: {
              ...search,
              ...page.data!.window,
              page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            },
          })
        }}
      />

      <Dialog
        open={Boolean(selectedEventId) && !accessDenied}
        onOpenChange={(open) => !open && setSelectedEventId("")}
      >
        {/* 详情没有固定内容长度；在弹层内滚动，避免长事实被视口截断。 */}
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
          showCloseButton={false}
        >
          <DialogClose
            render={
              <Button
                variant="ghost"
                className="absolute end-4 top-4"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">{t("common:close")}</span>
          </DialogClose>
          <DialogHeader>
            <DialogTitle>
              {details.isSuccess
                ? eventLabel(details.data, eventLabels)
                : t("organization:auditDetails")}
            </DialogTitle>
            <DialogDescription>
              {t("organization:auditDetailDescription")}
            </DialogDescription>
          </DialogHeader>
          {details.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("organization:auditLoading")}
            </p>
          )}
          {details.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("organization:auditError")}
            </p>
          )}
          {details.isSuccess && (
            <div className="space-y-4">
              {details.data.publicSummary && (
                <p dir="auto">{details.data.publicSummary}</p>
              )}
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t("organization:auditOccurredAt")}
                  </dt>
                  <dd>{details.data.occurredAt}</dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">
                    {t("organization:auditResult")}
                  </dt>
                  <dd>{resultLabel(details.data.result)}</dd>
                </div>
                {details.data.actorId && (
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      {t("organization:auditActor")}
                    </dt>
                    <dd dir="auto" className="break-all">
                      {details.data.actorId}
                    </dd>
                  </div>
                )}
                {details.data.resourceId && (
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      {t("organization:auditResourceId")}
                    </dt>
                    <dd dir="auto" className="break-all">
                      {details.data.resourceId}
                    </dd>
                  </div>
                )}
              </dl>
              <EventMetadata event={details.data} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

export function AuditEventsRoute() {
  const { organizationId } = useParams({ from: auditPath })
  const search = useSearch({ from: auditPath })
  return (
    <AuditWorkspace
      key={organizationId}
      organizationId={organizationId}
      search={search}
    />
  )
}
