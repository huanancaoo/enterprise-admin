import { PlatformExportButton } from "../tasks/task-actions"
import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useForm } from "@tanstack/react-form"
import {
  Link,
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
  useRouter,
} from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import {
  ApiClientError,
  getPlatformUser,
  getPlatformSensitiveProfile,
  listPlatformUsers,
} from "@workspace/api-client"
import {
  PlatformUsersPageSchema,
  PlatformUserDetailSchema,
  PlatformSensitiveProfileSchema,
  SensitiveProfileQuerySchema,
  type PlatformUsersPage,
  type PlatformUserDetail,
} from "@workspace/contracts/platform"
import {
  ErrorState,
  LoadingState,
  NotFoundContent,
  PermissionDeniedState,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { ArrowLeftIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardHeader } from "@workspace/ui/components/card"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
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
  DialogTrigger,
  DialogClose,
} from "@workspace/ui/components/dialog"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import {
  CreatePlatformAccount,
  PlatformAccountActions,
} from "./account-management"
import { authClient } from "../../lib/auth-client"
import { PlatformPasswordLoginLock } from "./password-login-lock"

type UserRow = PlatformUsersPage["items"][number]
const userColumns = createDataTableColumnHelper<UserRow>()
const EMPTY_USERS: UserRow[] = []

export function PlatformUsersPage() {
  const { t } = useTranslation("organization")
  const { t: identityText } = useTranslation("identity")
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const queryClient = useQueryClient()
  const search = useSearch({ from: "/platform/users" })
  const navigate = useNavigate({ from: "/platform/users" })
  const locale = useUiLocale()
  const query = useQuery({
    queryKey: ["platform", session.user.id, "users", search],
    queryFn: async ({ signal }) =>
      PlatformUsersPageSchema.parse(
        (await listPlatformUsers(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  const columns = useMemo(() => {
    const format = createFormatter(locale)
    return userColumns.columns([
      userColumns.accessor("userId", {
        header: t("platformUserId"),
        cell: ({ getValue }) => (
          <bdi className="font-mono text-xs">{getValue()}</bdi>
        ),
        meta: { label: t("platformUserId") },
        size: 290,
      }),
      userColumns.accessor("name", {
        header: t("platformName"),
        cell: ({ row, getValue }) => (
          <Link
            to="/platform/users/$userId"
            params={{ userId: row.original.userId }}
            className="font-medium wrap-anywhere underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {getValue()}
          </Link>
        ),
        meta: { label: t("platformName") },
        size: 220,
      }),
      userColumns.accessor("maskedEmail", {
        header: t("platformMaskedEmail"),
        cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
        meta: { label: t("platformMaskedEmail") },
        size: 230,
      }),
      userColumns.accessor("emailVerified", {
        header: t("platformEmailVerified"),
        cell: ({ getValue }) => (
          <Badge variant={getValue() ? "secondary" : "outline"}>
            {getValue() ? t("platformVerified") : t("platformUnverified")}
          </Badge>
        ),
        meta: { label: t("platformEmailVerified") },
      }),
      userColumns.accessor("status", {
        header: identityText("accountStatus"),
        cell: ({ getValue }) => (
          <Badge
            variant={getValue() === "active" ? "secondary" : "destructive"}
          >
            {identityText(getValue())}
          </Badge>
        ),
        meta: { label: identityText("accountStatus") },
      }),
      userColumns.accessor("lockedUntil", {
        header: identityText("passwordLoginLock"),
        cell: ({ row, getValue }) => (
          <PlatformPasswordLoginLock
            userId={row.original.userId}
            name={row.original.name}
            lockedUntil={getValue()}
            canUnlock={platformAccess.permissions.includes(
              "platform.user:unlock"
            )}
          />
        ),
        meta: { label: identityText("passwordLoginLock") },
        size: 220,
      }),
      userColumns.accessor("createdAt", {
        header: t("platformCreatedAt"),
        cell: ({ getValue }) =>
          format.dateTime(new Date(getValue()), "UTC", {
            dateStyle: "medium",
            timeStyle: "short",
          }),
        meta: { label: t("platformCreatedAt") },
        size: 210,
      }),
      userColumns.accessor("organizationCount", {
        header: t("platformOrganizationCount"),
        cell: ({ getValue }) => format.number(getValue()),
        meta: { label: t("platformOrganizationCount") },
      }),
    ])
  }, [locale, t, identityText, platformAccess.permissions])
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
        {t("platformUsers")}
      </h1>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_USERS}
        getRowId={(row) => row.userId}
        rowCount={query.data?.total ?? 0}
        status={status}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={false}
        searchPlaceholder={t("platformUsersSearch")}
        searchMaxLength={200}
        toolbarContent={
          <>
            {platformAccess.permissions.includes("platform.user:export") && (
              <PlatformExportButton resource="user" filters={search} />
            )}
            {platformAccess.permissions.includes("platform.user:create") && (
              <CreatePlatformAccount
                onCreated={(user) => {
                  queryClient.setQueryData(
                    ["platform", session.user.id, "user", user.userId],
                    user
                  )
                  void queryClient.invalidateQueries({
                    queryKey: ["platform", session.user.id, "users"],
                  })
                  void navigate({
                    to: "/platform/users/$userId",
                    params: { userId: user.userId },
                  })
                }}
              />
            )}
          </>
        }
        state={{ globalFilter: search.q ?? "", pagination }}
        onResetFilters={() =>
          void navigate({ search: { ...search, page: 1, q: undefined } })
        }
        onGlobalFilterChange={(updater) => {
          const q =
            typeof updater === "function" ? updater(search.q ?? "") : updater
          void navigate({ search: { ...search, page: 1, q: q || undefined } })
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

function SensitiveProfile({ userId }: { userId: string }) {
  const { t } = useTranslation("organization")
  const router = useRouter()
  const [email, setEmail] = useState<string>()
  const [failed, setFailed] = useState(false)
  const form = useForm({
    defaultValues: { purpose: "" },
    validators: {
      onSubmit: ({ value }) =>
        SensitiveProfileQuerySchema.safeParse(value).success
          ? undefined
          : {
              fields: { purpose: { message: t("platformReadPurposeInvalid") } },
            },
    },
    onSubmit: async ({ value }) => {
      setEmail(undefined)
      setFailed(false)
      try {
        // 完整邮箱只在本次显式展开内保存，不进入目录 Query Cache 或持久化缓存。
        const profile = PlatformSensitiveProfileSchema.parse(
          (await getPlatformSensitiveProfile(userId, value)).data
        )
        setEmail(profile.email)
      } catch (error) {
        setFailed(true)
        if (
          error instanceof ApiClientError &&
          [401, 403].includes(error.status)
        )
          await router.invalidate()
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => (
        <form
          aria-busy={submitting}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            <form.Field name="purpose">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel htmlFor="sensitive-purpose">
                      {t("platformReadPurpose")}
                    </FieldLabel>
                    <Textarea
                      id="sensitive-purpose"
                      value={field.state.value}
                      required
                      maxLength={500}
                      disabled={submitting}
                      aria-invalid={invalid}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <Button variant="secondary" type="submit" disabled={submitting}>
              {t("platformReadFullEmail")}
            </Button>
            {failed && (
              <p
                role="alert"
                className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              >
                {t("platformSensitiveReadFailed")}
              </p>
            )}
            {email && (
              <p
                role="status"
                className="rounded-xl bg-muted px-4 py-3 text-sm break-all"
              >
                <bdi>{email}</bdi>
              </p>
            )}
          </FieldGroup>
        </form>
      )}
    </form.Subscribe>
  )
}

export function PlatformUserDetailPage() {
  const { t } = useTranslation("organization")
  const { t: identityText } = useTranslation("identity")
  const { userId } = useParams({ from: "/platform/users/$userId" })
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const session = useAuthenticatedSession()!
  const nativeSession = authClient.useSession()
  const queryClient = useQueryClient()
  const format = createFormatter(useUiLocale())
  const [open, setOpen] = useState(false)
  const query = useQuery({
    queryKey: ["platform", session.user.id, "user", userId],
    queryFn: async ({ signal }) =>
      PlatformUserDetailSchema.parse(
        (await getPlatformUser(userId, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return query.error instanceof ApiClientError &&
      query.error.status === 404 ? (
      <NotFoundContent />
    ) : query.error instanceof ApiClientError && query.error.status === 403 ? (
      <PermissionDeniedState />
    ) : (
      <ErrorState onRetry={() => void query.refetch()} />
    )
  const user = query.data
  return (
    <section className="min-w-0 space-y-6">
      <Link
        to="/platform/users"
        search={{ page: 1, pageSize: 20 }}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeftIcon className="size-4 rtl:rotate-180" />
        {t("platformUsers")}
      </Link>
      <h1 className="font-heading text-2xl font-semibold tracking-tight break-words sm:text-3xl">
        {user.name}
      </h1>
      {[
        "platform.user:update",
        "platform.user:suspend",
        "platform.user:resetPassword",
      ].some((permission) =>
        platformAccess.permissions.includes(permission)
      ) && (
        <PlatformAccountActions
          key={`${user.userId}-${user.version}`}
          user={user}
          permissions={platformAccess.permissions}
          onSaved={(result) => {
            queryClient.setQueryData(
              ["platform", session.user.id, "user", userId],
              {
                ...user,
                name: result.name,
                status: result.status,
                version: result.version,
              }
            )
            void queryClient.invalidateQueries({
              queryKey: ["platform", session.user.id, "users"],
            })
            if (userId === session.user.id)
              void nativeSession.refetch({
                query: { disableCookieCache: true },
              })
          }}
        />
      )}
      <Card>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [&_dd]:mt-1 [&_dd]:font-medium [&_dd]:break-words [&_dt]:text-sm [&_dt]:text-muted-foreground [&>div]:min-w-0">
            <div>
              <dt>{t("platformUserId")}</dt>
              <dd>
                <bdi className="font-mono text-xs">{user.userId}</bdi>
              </dd>
            </div>
            <div>
              <dt>{t("platformMaskedEmail")}</dt>
              <dd>
                <bdi>{user.maskedEmail}</bdi>
              </dd>
            </div>
            <div>
              <dt>{identityText("accountStatus")}</dt>
              <dd>
                <Badge
                  variant={
                    user.status === "active" ? "secondary" : "destructive"
                  }
                >
                  {identityText(user.status)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{identityText("passwordLoginLock")}</dt>
              <dd>
                <PlatformPasswordLoginLock
                  userId={user.userId}
                  name={user.name}
                  lockedUntil={user.lockedUntil}
                  canUnlock={platformAccess.permissions.includes(
                    "platform.user:unlock"
                  )}
                  showExpiry
                />
              </dd>
            </div>
            <div>
              <dt>{t("platformEmailVerified")}</dt>
              <dd>
                <Badge variant={user.emailVerified ? "secondary" : "outline"}>
                  {user.emailVerified
                    ? t("platformVerified")
                    : t("platformUnverified")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{t("platformTwoFactorEnabled")}</dt>
              <dd>
                <Badge
                  variant={user.twoFactorEnabled ? "secondary" : "outline"}
                >
                  {user.twoFactorEnabled
                    ? t("platformEnabled")
                    : t("platformDisabled")}
                </Badge>
              </dd>
            </div>
            <div>
              <dt>{t("platformCreatedAt")}</dt>
              <dd>
                {format.dateTime(new Date(user.createdAt), "UTC", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      {platformAccess.permissions.includes("platform.user:readSensitive") && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button variant="secondary" />}>
            {t("platformReadFullEmail")}
          </DialogTrigger>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>{t("platformReadFullEmail")}</DialogTitle>
              <DialogDescription>
                {t("platformSensitiveDescription")}
              </DialogDescription>
            </DialogHeader>
            {open && <SensitiveProfile key={userId} userId={userId} />}
            <DialogClose render={<Button variant="outline" />}>
              {t("platformCloseSensitive")}
            </DialogClose>
          </DialogContent>
        </Dialog>
      )}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            {t("platformUserOrganizations")}
          </h2>
        </CardHeader>
        <CardContent>
          <UserOrganizations data={user.organizations} />
        </CardContent>
      </Card>
    </section>
  )
}

function UserOrganizations({
  data,
}: {
  data: PlatformUserDetail["organizations"]
}) {
  const { t } = useTranslation("organization")
  const locale = useUiLocale()
  const columns = useMemo(() => {
    const helper =
      createDataTableColumnHelper<PlatformUserDetail["organizations"][number]>()
    const format = createFormatter(locale)
    return helper.columns([
      helper.accessor("name", {
        header: t("platformName"),
        meta: { label: t("platformName") },
      }),
      helper.accessor("slug", {
        header: t("platformSlug"),
        cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
        meta: { label: t("platformSlug") },
      }),
      helper.accessor("status", {
        header: t("platformStatus"),
        cell: ({ getValue }) =>
          getValue() === "ACTIVE"
            ? t("platformActive")
            : t("platformSuspended"),
        meta: { label: t("platformStatus") },
      }),
      helper.accessor("role", {
        header: t("platformUserRole"),
        cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
        meta: { label: t("platformUserRole") },
      }),
      helper.accessor("joinedAt", {
        header: t("platformJoinedAt"),
        cell: ({ getValue }) =>
          format.dateTime(new Date(getValue()), "UTC", { dateStyle: "medium" }),
        meta: { label: t("platformJoinedAt") },
      }),
    ])
  }, [locale, t])
  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(row) => row.organizationId}
      showSearch={false}
      enableRowSelection={false}
    />
  )
}
