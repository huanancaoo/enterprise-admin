import { useEffect, useState } from "react"
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
  PlatformUsersQuerySchema,
} from "@workspace/contracts"
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NotFoundContent,
  Pagination,
} from "@workspace/admin"
import { useAuthenticatedSession } from "@workspace/admin/auth"
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
  FieldLabel,
  FieldError,
  FieldGroup,
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
  DialogTrigger,
  DialogClose,
} from "@workspace/ui/components/dialog"
import { authClient } from "../../lib/auth-client"

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
      } else if (error.body.code === "PLATFORM_MFA_REQUIRED") {
        await navigate({ to: "/platform/mfa", search: { challenge: false } })
      } else await navigate({ to: "/platform/access-denied" })
    })()
  }, [error, navigate, queryClient, refetch, session.user.id])
}

function UserSearch({
  search,
  onApply,
}: {
  search: { q?: string; page: number; pageSize: number }
  onApply: (q: string) => void
}) {
  const { t } = useTranslation("organization")
  const form = useForm({
    defaultValues: { q: search.q ?? "" },
    validators: {
      onSubmit: ({ value }) =>
        PlatformUsersQuerySchema.pick({ q: true }).required().safeParse(value)
          .success
          ? undefined
          : { fields: { q: { message: t("platformUsersSearchInvalid") } } },
    },
    onSubmit: ({ value }) => onApply(value.q),
  })
  return (
    <form
      className="rounded-2xl bg-muted/30 p-4 ring-1 ring-foreground/10 sm:p-5"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <form.Field name="q">
          {(field) => {
            const invalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="users-search">
                  {t("platformUsersSearch")}
                </FieldLabel>
                <Input
                  id="users-search"
                  value={field.state.value}
                  maxLength={200}
                  aria-invalid={invalid}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
                {invalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
        <Button type="submit" className="shrink-0">
          {t("platformApplyFilters")}
        </Button>
      </FieldGroup>
    </form>
  )
}

export function PlatformUsersPage() {
  const { t } = useTranslation("organization")
  const session = useAuthenticatedSession()!
  const search = useSearch({ from: "/platform/users" })
  const navigate = useNavigate({ from: "/platform/users" })
  const format = createFormatter(useUiLocale())
  const query = useQuery({
    queryKey: ["platform", session.user.id, "users", search],
    queryFn: async ({ signal }) =>
      PlatformUsersPageSchema.parse(
        (await listPlatformUsers(search, { signal })).data
      ),
    retry: false,
  })
  useAccessError(query.error)
  return (
    <section className="min-w-0 space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("platformUsers")}
      </h1>
      <UserSearch
        key={search.q ?? ""}
        search={search}
        onApply={(q) => void navigate({ search: { ...search, q, page: 1 } })}
      />
      {query.isPending ? (
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
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("platformUserId")}</TableHead>
                    <TableHead>{t("platformName")}</TableHead>
                    <TableHead>{t("platformMaskedEmail")}</TableHead>
                    <TableHead>{t("platformEmailVerified")}</TableHead>
                    <TableHead>{t("platformCreatedAt")}</TableHead>
                    <TableHead>{t("platformOrganizationCount")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.items.map((user) => (
                    <TableRow key={user.userId}>
                      <TableCell>
                        <bdi className="font-mono text-xs">{user.userId}</bdi>
                      </TableCell>
                      <TableCell className="max-w-56 break-words whitespace-normal">
                        <Link
                          className="font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          to="/platform/users/$userId"
                          params={{ userId: user.userId }}
                        >
                          {user.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <bdi>{user.maskedEmail}</bdi>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={user.emailVerified ? "secondary" : "outline"}
                        >
                          {user.emailVerified
                            ? t("platformVerified")
                            : t("platformUnverified")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {format.dateTime(new Date(user.createdAt), "UTC", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </TableCell>
                      <TableCell>
                        {format.number(user.organizationCount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Pagination
            pageIndex={search.page - 1}
            pageSize={search.pageSize}
            rowCount={query.data.total}
            pageCount={Math.ceil(query.data.total / search.pageSize)}
            disabled={query.isFetching}
            onPageChange={(page) =>
              void navigate({ search: { ...search, page: page + 1 } })
            }
            onPageSizeChange={(pageSize) =>
              void navigate({ search: { ...search, page: 1, pageSize } })
            }
          />
        </>
      )}
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
  const { userId } = useParams({ from: "/platform/users/$userId" })
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const session = useAuthenticatedSession()!
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
  useAccessError(query.error)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return query.error instanceof ApiClientError &&
      query.error.status === 404 ? (
      <NotFoundContent />
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
      {platformAccess.role === "platform_admin" && (
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
          {user.organizations.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
              {/* 只读表格没有可聚焦操作，键盘通过表格本身滚动长字段。 */}
              <Table
                className="min-w-[680px]"
                tabIndex={0}
                aria-label={t("platformUserOrganizations")}
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("platformName")}</TableHead>
                    <TableHead>{t("platformSlug")}</TableHead>
                    <TableHead>{t("platformStatus")}</TableHead>
                    <TableHead>{t("platformUserRole")}</TableHead>
                    <TableHead>{t("platformJoinedAt")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {user.organizations.map((organization) => (
                    <TableRow key={organization.organizationId}>
                      <TableCell>{organization.name}</TableCell>
                      <TableCell>
                        <bdi>{organization.slug}</bdi>
                      </TableCell>
                      <TableCell>
                        {organization.status === "ACTIVE"
                          ? t("platformActive")
                          : t("platformSuspended")}
                      </TableCell>
                      <TableCell>
                        <bdi>{organization.role}</bdi>
                      </TableCell>
                      <TableCell>
                        {format.dateTime(
                          new Date(organization.joinedAt),
                          "UTC",
                          {
                            dateStyle: "medium",
                          }
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
