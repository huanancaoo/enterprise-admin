import { useEffect, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
} from "@workspace/contracts"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NotFoundContent,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@workspace/ui/components/dialog"
import { authClient } from "../../lib/auth-client"

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
    purpose: PlatformAuditQuerySchema.shape.purpose,
    organizationId: optionalText(
      PlatformAuditQuerySchema.shape.organizationId.unwrap()
    ),
    actorId: optionalText(PlatformAuditQuerySchema.shape.actorId.unwrap()),
    eventCode: optionalText(PlatformAuditQuerySchema.shape.eventCode.unwrap()),
    result: optionalText(PlatformAuditQuerySchema.shape.result.unwrap()),
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

const names = [
  "purpose",
  "organizationId",
  "actorId",
  "eventCode",
  "result",
  "from",
  "to",
] as const
const labels = {
  purpose: "platformReadPurpose",
  organizationId: "platformAuditOrganization",
  actorId: "auditActor",
  eventCode: "auditEventCode",
  result: "auditResult",
  from: "platformAuditFrom",
  to: "platformAuditTo",
} as const

function useAccessError(error: unknown) {
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { refetch } = authClient.useSession()
  useEffect(() => {
    if (
      !(error instanceof ApiClientError) ||
      ![401, 403].includes(error.status)
    )
      return
    void (async () => {
      const queryKey = ["platform", session.user.id]
      await queryClient.cancelQueries({ queryKey })
      queryClient.removeQueries({ queryKey })
      if (error.status === 401) {
        await refetch()
        await navigate({ to: "/login" })
      } else if (error.body.code === "PLATFORM_MFA_REQUIRED")
        await navigate({ to: "/platform/mfa", search: { challenge: false } })
      else await navigate({ to: "/platform/access-denied" })
    })()
  }, [error, navigate, queryClient, refetch, session.user.id])
}

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
  initialPurpose,
  loading,
  onApply,
}: {
  search: Omit<PlatformAuditQuery, "purpose" | "cursor">
  initialPurpose: string
  loading: boolean
  onApply: (query: PlatformAuditQuery) => Promise<void>
}) {
  const { t } = useTranslation("organization")
  const form = useForm({
    defaultValues: {
      purpose: initialPurpose,
      organizationId: search.organizationId ?? "",
      actorId: search.actorId ?? "",
      eventCode: search.eventCode ?? "",
      result: search.result ?? "",
      from: search.from ? new Date(search.from).toISOString().slice(0, 16) : "",
      to: search.to ? new Date(search.to).toISOString().slice(0, 16) : "",
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
                message: t(
                  issue.path[0] === "purpose"
                    ? "platformReadPurposeInvalid"
                    : "platformAuditInvalid"
                ),
              },
            ])
          ),
        }
      },
    },
    onSubmit: async ({ value }) => onApply(filterSchema.parse(value)),
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(busy) => (
        <form
          className="rounded-2xl bg-muted/30 p-4 ring-1 ring-foreground/10 sm:p-5"
          noValidate
          aria-busy={busy || loading}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={busy || loading} className="space-y-4">
            <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {names.map((name) => (
                <form.Field key={name} name={name}>
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field
                        className={
                          name === "purpose"
                            ? "sm:col-span-2 lg:col-span-3"
                            : undefined
                        }
                        data-invalid={invalid}
                      >
                        <FieldLabel htmlFor={`platform-audit-${name}`}>
                          {t(labels[name])}
                        </FieldLabel>
                        {name === "result" ? (
                          <Select
                            items={[
                              { value: "", label: t("auditAnyResult") },
                              ...(
                                [
                                  "succeeded",
                                  "denied",
                                  "failed",
                                  "no_change",
                                ] as const
                              ).map((result) => ({
                                value: result,
                                label: t(`audit_result_${result}`),
                              })),
                            ]}
                            value={field.state.value}
                            onValueChange={(value) => {
                              if (value !== null) field.handleChange(value)
                            }}
                          >
                            <SelectTrigger
                              id={`platform-audit-${name}`}
                              className="w-full data-placeholder:text-foreground"
                              onBlur={field.handleBlur}
                              aria-invalid={invalid}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="">
                                {t("auditAnyResult")}
                              </SelectItem>
                              {(
                                [
                                  "succeeded",
                                  "denied",
                                  "failed",
                                  "no_change",
                                ] as const
                              ).map((result) => (
                                <SelectItem key={result} value={result}>
                                  {t(`audit_result_${result}`)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            id={`platform-audit-${name}`}
                            type={
                              name === "from" || name === "to"
                                ? "datetime-local"
                                : "text"
                            }
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                            required={name === "purpose"}
                            maxLength={
                              name === "purpose"
                                ? 500
                                : name === "eventCode"
                                  ? 120
                                  : 36
                            }
                          />
                        )}
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              ))}
            </FieldGroup>
            <Button type="submit">{t("platformApplyFilters")}</Button>
          </fieldset>
        </form>
      )}
    </form.Subscribe>
  )
}

function AuditDetail({
  eventId,
  purpose,
  onClose,
}: {
  eventId: string
  purpose: string
  onClose: () => void
}) {
  const { t } = useTranslation("organization")
  const session = useAuthenticatedSession()!
  const format = createFormatter(useUiLocale())
  const query = useQuery({
    queryKey: ["platform", session.user.id, "audit-detail", eventId, purpose],
    queryFn: async ({ signal }) =>
      PlatformAuditEventSchema.parse(
        (await getPlatformAuditEvent(eventId, { purpose }, { signal })).data
      ),
    retry: false,
  })
  useAccessError(query.error)
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
          <DialogTitle>{t("auditDetails")}</DialogTitle>
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

function AuditWorkspace({
  search,
  purpose,
  applying,
  onApply,
}: {
  search: Omit<PlatformAuditQuery, "purpose" | "cursor">
  purpose: string | null
  applying: boolean
  onApply: (query: PlatformAuditQuery) => Promise<void>
}) {
  const { t } = useTranslation(["organization", "common"])
  const session = useAuthenticatedSession()!
  const format = createFormatter(useUiLocale())
  const scopeLabels = useScopeLabels()
  const applied = purpose === null ? null : { ...search, purpose }
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ["platform", session.user.id, "audit", applied, cursors.at(-1)],
    queryFn: async ({ signal }) =>
      PlatformAuditPageSchema.parse(
        (
          await listPlatformAuditEvents(
            { ...applied!, cursor: cursors.at(-1), limit: 20 },
            { signal }
          )
        ).data
      ),
    enabled: applied !== null && !applying,
    retry: false,
  })
  useAccessError(query.error)
  return (
    <section className="min-w-0 space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("organization:audit")}
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {t("organization:platformAuditDescription")}
        </p>
      </div>
      <AuditFilters
        key={JSON.stringify(search)}
        search={search}
        initialPurpose={applied?.purpose ?? ""}
        loading={query.isFetching || applying}
        onApply={onApply}
      />
      {!applied ? (
        <p className="rounded-2xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
          {t("organization:platformAuditEnterPurpose")}
        </p>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              className="overflow-x-auto rounded-2xl bg-card ring-1 ring-foreground/10"
              aria-busy={query.isFetching}
            >
              <Table className="min-w-[960px] [&_td]:align-top">
                <TableHeader>
                  <TableRow>
                    {[
                      "auditOccurredAt",
                      "auditEventCode",
                      "platformAuditScope",
                      "platformAuditOrganization",
                      "auditActor",
                      "auditResult",
                      "auditDetails",
                    ].map((key) => (
                      <TableHead key={key}>
                        {t(`organization:${key}` as never)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        {format.dateTime(new Date(event.occurredAt), "UTC", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell className="max-w-56 break-words whitespace-normal">
                        <bdi className="text-sm">{event.eventCode}</bdi>
                      </TableCell>
                      <TableCell>{scopeLabels[event.scope]}</TableCell>
                      <TableCell className="max-w-64 break-words whitespace-normal">
                        {event.targetOrganization ? (
                          <>
                            <span>{event.targetOrganization.name}</span>
                            <br />
                            <bdi className="text-xs text-muted-foreground">
                              {event.targetOrganization.organizationId}
                            </bdi>
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="max-w-56 break-words whitespace-normal">
                        {t(`organization:auditActor_${event.actorType}`)}
                        <br />
                        <bdi>{event.actorMaskedEmail ?? event.actorId}</bdi>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            event.result === "succeeded"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {t(`organization:audit_result_${event.result}`)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelected(event.id)}
                        >
                          {t("organization:auditDetails")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={cursors.length === 1 || query.isFetching}
              onClick={() => setCursors((current) => current.slice(0, -1))}
            >
              {t("common:previous")}
            </Button>
            <Button
              variant="secondary"
              disabled={!query.data.nextCursor || query.isFetching}
              onClick={() =>
                setCursors((current) => [...current, query.data.nextCursor!])
              }
            >
              {t("common:next")}
            </Button>
          </div>
        </>
      )}
      {selected && applied && (
        <AuditDetail
          eventId={selected}
          purpose={applied.purpose}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}

export function PlatformAuditPage() {
  const search = useSearch({ from: "/platform/audit-events" })
  const navigate = useNavigate({ from: "/platform/audit-events" })
  const [purpose, setPurpose] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  return (
    <AuditWorkspace
      key={JSON.stringify(search)}
      search={search}
      purpose={purpose}
      applying={applying}
      onApply={async (query) => {
        // 目的只留在本页内存；URL 变更重建分页和详情，刷新后须重新填写目的。
        const { purpose, ...filters } = query
        setApplying(true)
        try {
          await navigate({ search: filters })
          setPurpose(purpose)
        } finally {
          setApplying(false)
        }
      }}
    />
  )
}
