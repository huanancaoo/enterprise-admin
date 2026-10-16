import { useMemo, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Link,
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { z } from "zod"
import {
  ConfirmDangerAction,
  ErrorState,
  LoadingState,
  PermissionDeniedState,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import {
  ApiClientError,
  dropOrganizationQueries,
  getPlatformOrganization,
  listPlatformOrganizations,
  resumePlatformOrganization,
  suspendPlatformOrganization,
} from "@workspace/api-client"
import {
  PlatformOrganizationDetailSchema,
  PlatformOrganizationPageSchema,
  PlatformOrganizationQuerySchema,
  type PlatformOrganizationDetail,
  type PlatformOrganizationPage,
  type TransitionOrganization,
} from "@workspace/contracts/platform"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { ArrowLeftIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  DataTable,
  DataTableColumnHeader,
  createDataTableColumnHelper,
  type DataTableStatus,
} from "@workspace/admin/data-table"
import { OrganizationStoragePolicy } from "../storage-policy/organization-storage-policy"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

type OrganizationRow = PlatformOrganizationPage["items"][number]
const organizationColumns = createDataTableColumnHelper<OrganizationRow>()
const EMPTY_ORGANIZATIONS: OrganizationRow[] = []

export function PlatformOrganizationsPage() {
  const { t } = useTranslation(["organization", "common"])
  const search = useSearch({ from: "/platform/organizations" })
  const navigate = useNavigate({ from: "/platform/organizations" })
  const session = useAuthenticatedSession()!
  const locale = useUiLocale()
  const query = useQuery({
    queryKey: ["platform", session.user.id, "organizations", search],
    queryFn: async ({ signal }) =>
      PlatformOrganizationPageSchema.parse(
        (await listPlatformOrganizations(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const columns = useMemo(() => {
    const format = createFormatter(locale)
    return organizationColumns.columns([
      organizationColumns.accessor("name", {
        header: ({ header }) => (
          <DataTableColumnHeader
            header={header}
            title={t("organization:platformName")}
          />
        ),
        cell: ({ row, getValue }) => (
          <Link
            to="/platform/organizations/$organizationId"
            params={{ organizationId: row.original.id }}
            className="font-medium wrap-anywhere underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {getValue()}
          </Link>
        ),
        meta: { label: t("organization:platformName") },
        size: 280,
      }),
      organizationColumns.accessor("slug", {
        header: ({ header }) => (
          <DataTableColumnHeader
            header={header}
            title={t("organization:platformSlug")}
          />
        ),
        cell: ({ getValue }) => (
          <bdi className="text-sm text-muted-foreground">{getValue()}</bdi>
        ),
        meta: { label: t("organization:platformSlug") },
        size: 220,
      }),
      organizationColumns.accessor("status", {
        header: t("organization:platformStatus"),
        cell: ({ getValue }) => (
          <Badge variant={getValue() === "ACTIVE" ? "secondary" : "outline"}>
            {getValue() === "ACTIVE"
              ? t("organization:platformActive")
              : t("organization:platformSuspended")}
          </Badge>
        ),
        enableSorting: false,
        meta: {
          label: t("organization:platformStatus"),
          facetMode: "single",
          facetOptions: [
            { value: "ACTIVE", label: t("organization:platformActive") },
            { value: "SUSPENDED", label: t("organization:platformSuspended") },
          ],
        },
      }),
      organizationColumns.accessor("createdAt", {
        header: ({ header }) => (
          <DataTableColumnHeader
            header={header}
            title={t("organization:platformCreatedAt")}
          />
        ),
        cell: ({ getValue }) =>
          format.dateTime(new Date(getValue()), "UTC", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        meta: { label: t("organization:platformCreatedAt") },
        size: 210,
      }),
      organizationColumns.accessor("memberCount", {
        header: ({ header }) => (
          <DataTableColumnHeader
            header={header}
            title={t("organization:platformMemberCount")}
          />
        ),
        cell: ({ getValue }) => format.number(getValue()),
        meta: { label: t("organization:platformMemberCount") },
      }),
    ])
  }, [locale, t])
  const sorting = [{ id: search.sortBy, desc: search.sortOrder === "desc" }]
  const columnFilters = search.status
    ? [{ id: "status", value: search.status }]
    : []
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
  return (
    <section className="min-w-0 space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("organization:platformOrganizations")}
      </h1>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_ORGANIZATIONS}
        getRowId={(row) => row.id}
        rowCount={query.data?.total ?? 0}
        status={status}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableRowSelection={false}
        enableMultiSort={false}
        searchPlaceholder={t("organization:platformSearch")}
        searchMaxLength={200}
        state={{
          globalFilter: search.q ?? "",
          columnFilters,
          sorting,
          pagination,
        }}
        onResetFilters={() =>
          void navigate({
            search: { ...search, page: 1, q: undefined, status: undefined },
          })
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, page: 1, q: q || undefined } })
        }}
        onColumnFiltersChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(columnFilters) : updater
          const value = next.find((filter) => filter.id === "status")?.value
          const status =
            PlatformOrganizationQuerySchema.shape.status.parse(value)
          void navigate({ search: { ...search, page: 1, status } })
        }}
        onSortingChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(sorting) : updater
          const sort = next[0]
          void navigate({
            search: {
              ...search,
              page: 1,
              sortBy: PlatformOrganizationQuerySchema.shape.sortBy.parse(
                sort?.id
              ),
              sortOrder: sort ? (sort.desc ? "desc" : "asc") : "desc",
            },
          })
        }}
        onPaginationChange={(updater) => {
          const next =
            typeof updater === "function" ? updater(pagination) : updater
          void navigate({
            search: {
              ...search,
              page: next.pageSize === search.pageSize ? next.pageIndex + 1 : 1,
              pageSize: next.pageSize,
            },
          })
        }}
      />
    </section>
  )
}

function dangerSchema(slug: string, copy: { reason: string; slug: string }) {
  return z.strictObject({
    reason: z.string().trim().min(10, copy.reason).max(500, copy.reason),
    slug: z.string().refine((value) => value === slug, copy.slug),
  })
}

type Attempt = {
  action: "suspend" | "resume"
  input: TransitionOrganization
  key: string
}
function OrganizationAction({
  organization,
  onChanged,
}: {
  organization: PlatformOrganizationDetail
  onChanged: (message: string) => void
}) {
  const { t } = useTranslation(["organization", "common", "auth"])
  const queryClient = useQueryClient()
  const session = useAuthenticatedSession()!
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<"suspend" | "resume">("suspend")
  const [version, setVersion] = useState(organization.version)
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const attempt = useRef<Attempt | null>(null)
  const rejectAccess = usePlatformAccessFailure()
  const actions = {
    suspend: {
      operation: suspendPlatformOrganization,
      trigger: t("organization:platformSuspend"),
      title: t("organization:platformSuspendConfirm"),
      confirm: t("organization:platformConfirmSuspend"),
      succeeded: t("organization:platformSuspendSucceeded"),
    },
    resume: {
      operation: resumePlatformOrganization,
      trigger: t("organization:platformResume"),
      title: t("organization:platformResumeConfirm"),
      confirm: t("organization:platformConfirmResume"),
      succeeded: t("organization:platformResumeSucceeded"),
    },
  }
  const form = useForm({
    defaultValues: { reason: "", slug: "" },
    validators: {
      onSubmit: dangerSchema(organization.slug, {
        reason: t("organization:platformReasonInvalid"),
        slug: t("organization:platformSlugInvalid"),
      }),
    },
    onSubmit: async ({ value }) => {
      if (conflict) return
      setError(undefined)
      const input = { reason: value.reason, expectedVersion: version }
      // 网络结果未知时重试同一请求体与键；后台刷新不能替换已确认的版本。
      if (
        !attempt.current ||
        JSON.stringify(attempt.current.input) !== JSON.stringify(input)
      ) {
        attempt.current = { action, input, key: crypto.randomUUID() }
      }
      const command = attempt.current
      try {
        const operation = actions[command.action].operation
        const result = await operation(organization.id, command.input, {
          "idempotency-key": command.key,
        })
        setOpen(false)
        setUncertain(false)
        attempt.current = null
        form.reset()
        dropOrganizationQueries(queryClient, organization.id)
        // 写入已确认成功；列表刷新失败由读取区域呈现，不把成功变更误报为提交失败。
        onChanged(
          result.data.changed
            ? actions[command.action].succeeded
            : t("organization:platformNoChange")
        )
        void queryClient.invalidateQueries({
          queryKey: ["platform", session.user.id],
        })
      } catch (failure) {
        const known = failure instanceof ApiClientError
        if (await rejectAccess(failure)) return
        setError(
          known ? failure.message : t("organization:platformResultUnknown")
        )
        setUncertain(!known)
        setConflict(known && failure.body.code === "VERSION_CONFLICT")
        if (known && failure.body.code === "VERSION_CONFLICT") {
          void queryClient.invalidateQueries({
            queryKey: ["platform", session.user.id],
          })
        }
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <ConfirmDangerAction
          open={open}
          onOpenChange={(value) => {
            setOpen(value)
            if (value) {
              setAction(organization.status === "ACTIVE" ? "suspend" : "resume")
              setVersion(organization.version)
              setError(undefined)
              setConflict(false)
              setUncertain(false)
              attempt.current = null
            }
          }}
          pending={pending}
          confirmDisabled={conflict}
          triggerLabel={
            actions[organization.status === "ACTIVE" ? "suspend" : "resume"]
              .trigger
          }
          title={actions[action].title}
          description={t("organization:platformDangerDescription", {
            name: organization.name,
            slug: organization.slug,
          })}
          cancelLabel={t("common:cancel")}
          confirmLabel={actions[action].confirm}
          pendingLabel={t("common:submitting")}
          error={error}
          onConfirm={() => void form.handleSubmit()}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
            aria-busy={pending}
          >
            <fieldset disabled={pending || uncertain} className="space-y-4">
              <FieldGroup>
                <form.Field name="reason">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor="organization-reason">
                          {t("organization:platformReason")}
                        </FieldLabel>
                        <Textarea
                          id="organization-reason"
                          required
                          minLength={10}
                          maxLength={500}
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="slug">
                  {(field) => {
                    const invalid =
                      field.state.meta.isTouched && !field.state.meta.isValid
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor="organization-confirm-slug">
                          {t("organization:platformSlug")}
                        </FieldLabel>
                        <Input
                          id="organization-confirm-slug"
                          required
                          dir="ltr"
                          autoComplete="off"
                          value={field.state.value}
                          onChange={(event) =>
                            field.handleChange(event.target.value)
                          }
                          onBlur={field.handleBlur}
                          aria-invalid={invalid}
                        />
                        {invalid && (
                          <FieldError errors={field.state.meta.errors} />
                        )}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
            </fieldset>
          </form>
          {conflict && (
            <div className="space-y-2">
              <p>
                {t("organization:platformLatestState", {
                  status:
                    organization.status === "ACTIVE"
                      ? t("organization:platformActive")
                      : t("organization:platformSuspended"),
                  version: organization.version,
                })}
              </p>
              <Button
                variant="outline"
                disabled={pending || organization.version === version}
                onClick={() => {
                  setVersion(organization.version)
                  setConflict(false)
                  setError(undefined)
                  attempt.current = null
                }}
              >
                {t("organization:platformReviewLatest")}
              </Button>
            </div>
          )}
        </ConfirmDangerAction>
      )}
    </form.Subscribe>
  )
}

export function PlatformOrganizationDetailPage() {
  const { organizationId } = useParams({
    from: "/platform/organizations/$organizationId",
  })
  const { t } = useTranslation(["organization", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const locale = useUiLocale()
  const format = createFormatter(locale)
  const [message, setMessage] = useState<string>()
  const query = useQuery({
    queryKey: ["platform", session.user.id, "organization", organizationId],
    queryFn: async ({ signal }) =>
      PlatformOrganizationDetailSchema.parse(
        (await getPlatformOrganization(organizationId, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  if (query.isPending) return <LoadingState />
  if (
    query.isError &&
    (!query.data ||
      (query.error instanceof ApiClientError &&
        [401, 403].includes(query.error.status)))
  )
    return query.error instanceof ApiClientError &&
      query.error.status === 403 ? (
      <PermissionDeniedState />
    ) : (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    )
  const organization = query.data
  return (
    <section className="min-w-0 space-y-6" aria-busy={query.isFetching}>
      <Link
        to="/platform/organizations"
        search={{
          page: 1,
          pageSize: 20,
          sortBy: "createdAt",
          sortOrder: "desc",
        }}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeftIcon className="size-4 rtl:rotate-180" />
        {t("organization:platformOrganizations")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="min-w-0 font-heading text-2xl font-semibold tracking-tight break-words sm:text-3xl">
          {organization.name}
        </h1>
        {platformAccess.role === "platform_admin" && (
          <OrganizationAction
            key={organization.id}
            organization={organization}
            onChanged={setMessage}
          />
        )}
      </div>
      {message && (
        <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">
          {message}
        </p>
      )}
      {query.isError && (
        <ErrorState
          message={
            query.error instanceof Error ? query.error.message : undefined
          }
          onRetry={() => void query.refetch()}
        />
      )}
      <Card>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [&_dd]:mt-1 [&_dd]:font-medium [&_dd]:break-words [&_dt]:text-sm [&_dt]:text-muted-foreground [&>div]:min-w-0">
            <div>
              <dt>{t("organization:platformId")}</dt>
              <dd>
                <bdi>{organization.id}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t("organization:platformSlug")}</dt>
              <dd>
                <bdi>{organization.slug}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t("organization:platformStatus")}</dt>
              <dd>
                <Badge
                  variant={
                    organization.status === "ACTIVE" ? "secondary" : "outline"
                  }
                >
                  {organization.status === "ACTIVE"
                    ? t("organization:platformActive")
                    : t("organization:platformSuspended")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{t("organization:platformVersion")}</dt>
              <dd>{format.number(organization.version)}</dd>
            </div>
            <div>
              <dt>{t("organization:platformCreatedAt")}</dt>
              <dd>
                {format.dateTime(new Date(organization.createdAt), "UTC", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
            <div>
              <dt>{t("organization:platformDefaultLocale")}</dt>
              <dd>
                {organization.defaultLocale ??
                  t("organization:platformInheritedLocale")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <OrganizationStoragePolicy
        key={organization.id}
        organizationId={organization.id}
      />
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            {t("organization:platformMembers")}
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("organization:platformMemberTotal", {
              total: format.number(organization.memberCount),
            })}
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {organization.members.map((item) => (
              <li
                key={item.role}
                className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3"
              >
                <bdi>
                  {item.role === "owner"
                    ? t("organization:role_owner")
                    : item.role === "admin"
                      ? t("organization:role_admin")
                      : item.role === "member"
                        ? t("organization:role_member")
                        : item.role}
                </bdi>
                <span className="text-lg font-semibold tabular-nums">
                  {format.number(item.count)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            {t("organization:platformHistory")}
          </h2>
        </CardHeader>
        <CardContent>
          {organization.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("organization:platformHistoryEmpty")}
            </p>
          ) : (
            <ul className="space-y-3">
              {organization.history.map((event) => (
                <li
                  key={event.id}
                  className="space-y-3 rounded-xl bg-muted/30 p-4"
                >
                  <p>
                    {event.eventCode === "platform.organization_suspended"
                      ? t("organization:platformSuspendSucceeded")
                      : t("organization:platformResumeSucceeded")}
                  </p>
                  <p>
                    {format.dateTime(new Date(event.occurredAt), "UTC", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                  <dl className="grid gap-2 text-sm [&_dd]:break-all [&_dt]:text-muted-foreground">
                    <dt>{t("organization:platformActor")}</dt>
                    <dd>
                      <bdi>{event.actorId}</bdi>
                    </dd>
                    <dt>{t("organization:platformOperationId")}</dt>
                    <dd>
                      <bdi>{event.operationId}</bdi>
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
