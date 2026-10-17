import { useMemo, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  ApiClientError,
  getPlatformAuditEvent,
  listPlatformAuditEvents,
} from "@workspace/api-client"
import {
  PlatformAuditQuerySchema,
  PlatformAuditPageSchema,
  PlatformAuditEventSchema,
  type PlatformAuditQuery,
  type PlatformAuditEvent,
} from "@workspace/contracts/platform"
import { ErrorState, LoadingState, NotFoundContent } from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { FilterIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  DataTable,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@workspace/ui/components/dialog"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { OrganizationCombobox } from "../../components/organization-combobox"
import { UserCombobox } from "../../components/user-combobox"

const optionalText = <T extends z.ZodType<string, string>>(schema: T) =>
  z
    .string()
    .trim()
    .pipe(schema.or(z.literal("")).transform((value) => value || undefined))
const utcInput = z
  .string()
  .transform((value) =>
    value ? `${value}${value.length === 16 ? ":00" : ""}Z` : undefined
  )
  .pipe(z.iso.datetime({ offset: true }).optional())
const filterSchema = z
  .strictObject({
    organizationId: optionalText(
      PlatformAuditQuerySchema.shape.organizationId.unwrap()
    ),
    actorId: optionalText(PlatformAuditQuerySchema.shape.actorId.unwrap()),
    from: utcInput,
    to: utcInput,
  })
  .refine(
    (query) => {
      const upper = query.to ? new Date(query.to).getTime() : Date.now()
      const lower = query.from
        ? new Date(query.from).getTime()
        : upper - 30 * 86400000
      return (
        lower <= upper && upper <= Date.now() && upper - lower <= 90 * 86400000
      )
    },
    { path: ["from"] }
  )

const dateNames = ["from", "to"] as const
const labels = {
  from: "platformAuditFrom",
  to: "platformAuditTo",
} as const

function useScopeLabels() {
  const { t } = useTranslation("organization")
  return {
    tenant: t("platformAuditScope_tenant"),
    platform: t("platformAuditScope_platform"),
    user: t("platformAuditScope_user"),
    security: t("platformAuditScope_security"),
  } satisfies Record<PlatformAuditEvent["scope"], string>
}

function AuditFilters({
  search,
  loading,
  onApply,
}: {
  search: PlatformAuditQuery
  loading: boolean
  onApply: (query: PlatformAuditQuery) => Promise<void>
}) {
  const { t } = useTranslation(["organization", "common"])
  const [open, setOpen] = useState(false)
  const filterCount = [
    search.organizationId,
    search.actorId,
    search.from || search.to,
  ].filter(Boolean).length
  const initialFrom = search.from
    ? new Date(search.from).toISOString().slice(0, 16)
    : ""
  const initialTo = search.to
    ? new Date(search.to).toISOString().slice(0, 16)
    : ""
  const form = useForm({
    defaultValues: {
      organizationId: search.organizationId ?? "",
      actorId: search.actorId ?? "",
      from: initialFrom,
      to: initialTo,
    },
    validators: {
      onSubmit: ({ value }) => {
        const result = filterSchema.safeParse(value)
        if (result.success) return undefined
        return {
          fields: Object.fromEntries(
            result.error.issues.map((issue) => [
              issue.path[0],
              {
                message: t("platformAuditInvalid"),
              },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => {
      const parsed = filterSchema.parse(value)
      await onApply({
        ...search,
        ...parsed,
        // 日期控件只编辑到分钟；未改动的边界继续使用数据库的原始精度。
        from: value.from === initialFrom ? search.from : parsed.from,
        to: value.to === initialTo ? search.to : parsed.to,
        page: 1,
        pageSize: search.pageSize,
      })
      setOpen(false)
    },
  })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" disabled={loading} />}
      >
        <FilterIcon data-icon="inline-start" />
        {t("organization:platformOperationAdvancedFilters")}
        {filterCount > 0 && <Badge variant="secondary">{filterCount}</Badge>}
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
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <form
              noValidate
              aria-busy={busy || loading}
              onSubmit={(event) => {
                event.preventDefault()
                void form.handleSubmit()
              }}
            >
              <fieldset disabled={busy || loading} className="space-y-4">
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  {(["organizationId", "actorId"] as const).map((name) => (
                    <form.Field key={name} name={name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        const id = `platform-audit-${name}`
                        const label =
                          name === "organizationId"
                            ? t("platformAuditOrganizationLabel")
                            : t("platformAuditActorLabel")
                        const Selector =
                          name === "organizationId"
                            ? OrganizationCombobox
                            : UserCombobox
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={id}>{label}</FieldLabel>
                            <Selector
                              id={id}
                              value={field.state.value || null}
                              placeholder={
                                name === "organizationId"
                                  ? t("platformAuditAllOrganizations")
                                  : t("platformAuditAllActors")
                              }
                              onValueChange={(value) =>
                                field.handleChange(value ?? "")
                              }
                              onBlur={field.handleBlur}
                              disabled={busy || loading}
                              invalid={invalid}
                              aria-describedby={
                                invalid ? `${id}-error` : undefined
                              }
                            />
                            {invalid && (
                              <FieldError
                                id={`${id}-error`}
                                errors={field.state.meta.errors}
                              />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))}
                  {dateNames.map((name) => (
                    <form.Field key={name} name={name}>
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel htmlFor={`platform-audit-${name}`}>
                              {t(labels[name])}
                            </FieldLabel>
                            <Input
                              id={`platform-audit-${name}`}
                              type="datetime-local"
                              value={field.state.value}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                              onBlur={field.handleBlur}
                              aria-invalid={invalid}
                              maxLength={36}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  ))}
                </FieldGroup>
                <div className="flex justify-end gap-2 border-t pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOpen(false)}
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
        </form.Subscribe>
      </PopoverContent>
    </Popover>
  )
}

function AuditDetail({
  eventId,
  onClose,
}: {
  eventId: string
  onClose: () => void
}) {
  const { t } = useTranslation("organization")
  const session = useAuthenticatedSession()!
  const format = createFormatter(useUiLocale())
  const query = useQuery({
    queryKey: ["platform", session.user.id, "audit-detail", eventId],
    queryFn: async ({ signal }) =>
      PlatformAuditEventSchema.parse(
        (await getPlatformAuditEvent(eventId, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const scopeLabels = useScopeLabels()
  const event = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="max-h-[85svh] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{t("platformOperationDetails")}</DialogTitle>
          <DialogDescription>
            {t("platformAuditDetailDescription")}
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          query.error instanceof ApiClientError &&
          query.error.status === 404 ? (
            <NotFoundContent />
          ) : (
            <ErrorState onRetry={() => void query.refetch()} />
          )
        ) : (
          event && (
            <dl className="grid gap-3 text-sm">
              {[
                [t("platformAuditId"), event.id],
                [
                  t("auditOccurredAt"),
                  format.dateTime(new Date(event.occurredAt), "UTC", {
                    dateStyle: "medium",
                    timeStyle: "long",
                  }),
                ],
                [t("auditEventCode"), event.eventCode],
                [t("platformAuditScope"), scopeLabels[event.scope]],
                [
                  t("platformAuditOrganization"),
                  event.targetOrganization
                    ? `${event.targetOrganization.name ?? ""} ${event.targetOrganization.organizationId}`
                    : "—",
                ],
                [
                  t("auditActor"),
                  `${t(`auditActor_${event.actorType}`)} ${event.actorMaskedEmail ?? ""} ${event.actorId ?? ""}`,
                ],
                [t("auditResourceType"), event.resourceType ?? "—"],
                [t("auditResourceId"), event.resourceId ?? "—"],
                [t("auditResult"), t(`audit_result_${event.result}`)],
                ...(Object.keys(event.metadata).length
                  ? [
                      [
                        t("platformAuditRoleChange"),
                        `${event.metadata.previousRole ?? "—"} → ${event.metadata.nextRole ?? "—"}`,
                      ],
                    ]
                  : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all">
                    <bdi>{value}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )
        )}
        <DialogClose render={<Button variant="secondary" />}>
          {t("platformAuditClose")}
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}

const auditColumns = createDataTableColumnHelper<PlatformAuditEvent>()
const EMPTY_EVENTS: PlatformAuditEvent[] = []

function AuditWorkspace({ search }: { search: PlatformAuditQuery }) {
  const { t } = useTranslation(["organization", "common"])
  const navigate = useNavigate({ from: "/platform/audit-events" })
  const session = useAuthenticatedSession()!
  const locale = useUiLocale()
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ["platform", session.user.id, "audit", search],
    queryFn: async ({ signal }) =>
      PlatformAuditPageSchema.parse(
        (await listPlatformAuditEvents(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const columns = useMemo(() => {
    const format = createFormatter(locale)
    return auditColumns.columns([
      auditColumns.accessor("occurredAt", {
        header: t("organization:auditOccurredAt"),
        cell: ({ getValue }) =>
          format.dateTime(new Date(getValue()), "UTC", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        meta: { label: t("organization:auditOccurredAt") },
        size: 210,
      }),
      auditColumns.accessor("eventCode", {
        header: t("organization:auditEventCode"),
        cell: ({ getValue }) => (
          <bdi className="text-sm wrap-anywhere">{getValue()}</bdi>
        ),
        meta: { label: t("organization:auditEventCode") },
        size: 250,
      }),
      auditColumns.accessor("scope", {
        header: t("organization:platformAuditScope"),
        cell: ({ getValue }) =>
          t(`organization:platformAuditScope_${getValue()}`),
        meta: { label: t("organization:platformAuditScope") },
      }),
      auditColumns.accessor("targetOrganization", {
        header: t("organization:platformAuditOrganization"),
        cell: ({ getValue }) => {
          const org = getValue()
          return org ? (
            <div className="wrap-anywhere">
              <span>{org.name}</span>
              <br />
              <bdi className="text-xs text-muted-foreground">
                {org.organizationId}
              </bdi>
            </div>
          ) : (
            "—"
          )
        },
        meta: { label: t("organization:platformAuditOrganization") },
        size: 260,
      }),
      auditColumns.accessor("actorId", {
        header: t("organization:auditActor"),
        cell: ({ row }) => (
          <div className="wrap-anywhere">
            {t(`organization:auditActor_${row.original.actorType}`)}
            <br />
            <bdi>{row.original.actorMaskedEmail ?? row.original.actorId}</bdi>
          </div>
        ),
        meta: { label: t("organization:auditActor") },
        size: 230,
      }),
      auditColumns.accessor("result", {
        header: t("organization:auditResult"),
        cell: ({ getValue }) => (
          <Badge variant={getValue() === "succeeded" ? "secondary" : "outline"}>
            {t(`organization:audit_result_${getValue()}`)}
          </Badge>
        ),
        meta: {
          label: t("organization:auditResult"),
          facetMode: "single",
          facetOptions: (
            ["succeeded", "denied", "failed", "no_change"] as const
          ).map((value) => ({
            value,
            label: t(`organization:audit_result_${value}`),
          })),
        },
      }),
      auditColumns.display({
        id: "details",
        header: t("organization:platformOperationDetails"),
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(row.original.id)}
          >
            {t("organization:platformOperationDetails")}
          </Button>
        ),
        enableHiding: false,
        meta: { label: t("organization:platformOperationDetails") },
      }),
    ])
  }, [locale, t])
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
  const columnFilters = [
    ...(search.result ? [{ id: "result", value: search.result }] : []),
    ...(search.organizationId
      ? [{ id: "targetOrganization", value: search.organizationId }]
      : []),
    ...(search.actorId ? [{ id: "actorId", value: search.actorId }] : []),
    ...(search.from || search.to
      ? [{ id: "occurredAt", value: { from: search.from, to: search.to } }]
      : []),
  ]
  return (
    <section className="min-w-0 space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("organization:platformOperationsLog")}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {t("organization:platformAuditDescription")}
        </p>
      </div>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_EVENTS}
        getRowId={(row) => row.id}
        rowCount={query.data?.total ?? 0}
        status={status}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        searchPlaceholder={t("organization:platformOperationEventSearch")}
        searchMaxLength={120}
        enableSorting={false}
        enableRowSelection={false}
        state={{
          pagination,
          globalFilter: search.eventCode ?? "",
          columnFilters,
        }}
        toolbarContent={
          <AuditFilters
            key={JSON.stringify(search)}
            search={search}
            loading={query.isFetching}
            onApply={(filters) => navigate({ search: filters })}
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
          const result = PlatformAuditQuerySchema.shape.result.parse(
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
          // 翻页沿用数据库解析的窗口及其精度。
          void navigate({
            search: {
              ...search,
              ...query.data!.window,
              page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            },
          })
        }}
      />
      {selected && (
        <AuditDetail eventId={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  )
}

export function PlatformAuditPage() {
  const search = useSearch({ from: "/platform/audit-events" })
  return <AuditWorkspace key={JSON.stringify(search)} search={search} />
}
