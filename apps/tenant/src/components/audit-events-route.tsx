import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"
import { useTranslation } from "react-i18next"
import type { AuditEvent } from "@workspace/contracts"
import { PageHeader } from "@workspace/admin"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  getOrganizationAuditEventOptions,
  getOrganizationAuditEventsOptions,
} from "@/query/organization-audit"
import { useUiLocale } from "@workspace/i18n/react"
import { z } from "zod"

const auditPath = "/app/organizations/$organizationId/audit"

type FilterValues = {
  from: string
  to: string
  actorId: string
  eventCode: string
  resourceType: string
  resourceId: string
  result: "" | "succeeded" | "denied" | "failed" | "no_change"
}

function createFilterSchema(messages: {
  invalidDate: string
  invalidId: string
  invalidDateRange: string
  rangeTooLong: string
}) {
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
      eventCode: z.string().max(120),
      resourceType: z.string().max(80),
      resourceId: uuidValue,
      result: z.enum(["", "succeeded", "denied", "failed", "no_change"]),
    })
    .superRefine((value, context) => {
      if (value.from && value.to && value.from > value.to)
        context.addIssue({
          code: "custom",
          path: ["to"],
          message: messages.invalidDateRange,
        })
      if (
        value.from &&
        value.to &&
        Date.parse(`${value.to}T00:00:00Z`) -
          Date.parse(`${value.from}T00:00:00Z`) >
          90 * 24 * 60 * 60 * 1000
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
    <dl className="grid gap-3 sm:grid-cols-2">
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

export function AuditEventsRoute() {
  const { organizationId } = useParams({ from: auditPath })
  const search = useSearch({ from: auditPath })
  const navigate = useNavigate({ from: auditPath })
  const { t } = useTranslation(["organization", "common"])
  const locale = useUiLocale()
  const eventLabels = {
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
  }
  const actorLabels = {
    deployment_operator: t("organization:auditActor_deployment_operator"),
    system: t("organization:auditActor_system"),
    user: t("organization:auditActor_user"),
  }
  const resultLabels = {
    denied: t("organization:audit_result_denied"),
    failed: t("organization:audit_result_failed"),
    no_change: t("organization:audit_result_no_change"),
    succeeded: t("organization:audit_result_succeeded"),
  }
  const filterSchema = useMemo(
    () =>
      createFilterSchema({
        invalidDate: t("organization:auditInvalidDate"),
        invalidId: t("organization:auditInvalidId"),
        invalidDateRange: t("organization:auditInvalidDateRange"),
        rangeTooLong: t("organization:auditRangeTooLong"),
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
  const filters = useForm({
    defaultValues: {
      from: search.from?.slice(0, 10) ?? "",
      to: search.to?.slice(0, 10) ?? "",
      actorId: search.actorId ?? "",
      eventCode: search.eventCode ?? "",
      resourceType: search.resourceType ?? "",
      resourceId: search.resourceId ?? "",
      result: search.result ?? "",
    },
    validators: { onSubmit: filterSchema },
    onSubmit: ({ value }) => applyFilters(value as FilterValues),
  })

  useEffect(() => {
    filters.setFieldValue("from", search.from?.slice(0, 10) ?? "")
    filters.setFieldValue("to", search.to?.slice(0, 10) ?? "")
    filters.setFieldValue("actorId", search.actorId ?? "")
    filters.setFieldValue("eventCode", search.eventCode ?? "")
    filters.setFieldValue("resourceType", search.resourceType ?? "")
    filters.setFieldValue("resourceId", search.resourceId ?? "")
    filters.setFieldValue("result", search.result ?? "")
  }, [
    filters,
    organizationId,
    search.actorId,
    search.eventCode,
    search.from,
    search.resourceId,
    search.resourceType,
    search.result,
    search.to,
  ])

  function applyFilters(value: FilterValues) {
    void navigate({
      search: {
        from: dateStart(value.from),
        to: dateEnd(value.to),
        actorId: value.actorId.trim() || undefined,
        eventCode: value.eventCode.trim() || undefined,
        resourceType: value.resourceType.trim() || undefined,
        resourceId: value.resourceId.trim() || undefined,
        result: value.result || undefined,
        cursor: undefined,
        limit: 20,
      },
    })
  }

  function resultLabel(result: string) {
    return resultLabels[result as keyof typeof resultLabels] ?? result
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title={t("organization:audit")}
        description={t("organization:auditDescription")}
      />

      <form
        className="rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void filters.handleSubmit()
        }}
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <filters.Field name="from">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditFrom")}
                </FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  aria-invalid={
                    field.state.meta.isTouched && !field.state.meta.isValid
                  }
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={field.state.meta.errors} />
                )}
              </Field>
            )}
          </filters.Field>
          <filters.Field name="to">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditTo")}
                </FieldLabel>
                <Input
                  id={field.name}
                  type="date"
                  aria-invalid={
                    field.state.meta.isTouched && !field.state.meta.isValid
                  }
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={field.state.meta.errors} />
                )}
              </Field>
            )}
          </filters.Field>
          <filters.Field name="actorId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditActor")}
                </FieldLabel>
                <Input
                  id={field.name}
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={field.state.meta.errors} />
                )}
              </Field>
            )}
          </filters.Field>
          <filters.Field name="eventCode">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditEventCode")}
                </FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </filters.Field>
          <filters.Field name="resourceType">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditResourceType")}
                </FieldLabel>
                <Input
                  id={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </filters.Field>
          <filters.Field name="resourceId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditResourceId")}
                </FieldLabel>
                <Input
                  id={field.name}
                  autoComplete="off"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={field.state.meta.errors} />
                )}
              </Field>
            )}
          </filters.Field>
          <filters.Field name="result">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>
                  {t("organization:auditResult")}
                </FieldLabel>
                <select
                  id={field.name}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                >
                  <option value="">{t("organization:auditAnyResult")}</option>
                  <option value="succeeded">{resultLabel("succeeded")}</option>
                  <option value="denied">{resultLabel("denied")}</option>
                  <option value="failed">{resultLabel("failed")}</option>
                  <option value="no_change">{resultLabel("no_change")}</option>
                </select>
              </Field>
            )}
          </filters.Field>
        </FieldGroup>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit">{t("organization:applyAuditFilters")}</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              void applyFilters({
                from: "",
                to: "",
                actorId: "",
                eventCode: "",
                resourceType: "",
                resourceId: "",
                result: "",
              })
            }
          >
            {t("organization:clearAuditFilters")}
          </Button>
        </div>
      </form>

      {page.isPending && <p role="status">{t("organization:auditLoading")}</p>}
      {page.isError && (
        <div className="space-y-2">
          <p role="alert">{t("organization:auditError")}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void page.refetch()}
          >
            {t("common:retry")}
          </Button>
        </div>
      )}
      {page.isSuccess && page.data.items.length === 0 && (
        <p
          role="status"
          className="rounded-lg border p-6 text-center text-muted-foreground"
        >
          {t("organization:auditEmpty")}
        </p>
      )}
      {page.isSuccess && page.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("organization:auditOccurredAt")}</TableHead>
                <TableHead>{t("organization:auditEventCode")}</TableHead>
                <TableHead>{t("organization:auditActor")}</TableHead>
                <TableHead>{t("organization:auditResourceType")}</TableHead>
                <TableHead>{t("organization:auditResult")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "UTC",
                    }).format(new Date(item.occurredAt))}
                  </TableCell>
                  <TableCell dir="auto">
                    <Button
                      variant="link"
                      className="h-auto p-0"
                      onClick={() => setSelectedEventId(item.id)}
                    >
                      {eventLabel(item, eventLabels)}
                    </Button>
                    {item.scope === "platform" && (
                      <span className="ms-2 text-xs text-muted-foreground">
                        {t("organization:auditPlatform")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell dir="auto">
                    {item.actorId ?? actorLabels[item.actorType]}
                  </TableCell>
                  <TableCell dir="auto">{item.resourceType ?? "—"}</TableCell>
                  <TableCell>{resultLabel(item.result)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {page.data?.nextCursor && (
        <Button
          variant="outline"
          disabled={page.isFetching}
          onClick={() =>
            void navigate({
              search: { ...search, cursor: page.data.nextCursor ?? undefined },
            })
          }
        >
          {page.isFetching
            ? t("organization:auditLoading")
            : t("organization:auditNextPage")}
        </Button>
      )}

      <Dialog
        open={Boolean(selectedEventId)}
        onOpenChange={(open) => !open && setSelectedEventId("")}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {details.data
                ? eventLabel(details.data, eventLabels)
                : t("organization:auditDetails")}
            </DialogTitle>
            <DialogDescription>
              {t("organization:auditDetailDescription")}
            </DialogDescription>
          </DialogHeader>
          {details.isPending && (
            <p role="status">{t("organization:auditLoading")}</p>
          )}
          {details.isError && (
            <p role="alert">{t("organization:auditError")}</p>
          )}
          {details.data && (
            <div className="space-y-4">
              {details.data.publicSummary && (
                <p dir="auto">{details.data.publicSummary}</p>
              )}
              <dl className="grid gap-3 sm:grid-cols-2">
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
