import { useId, useMemo, useState } from "react"
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
  listPlatformEmployees,
  getPlatformEmployee,
  createPlatformEmployee,
  updatePlatformEmployee,
  setPlatformEmployeeStatus,
  setPlatformEmployeeRoles,
  deletePlatformEmployee,
  batchRemovePlatformEmployees,
  listPlatformEmployeeDepartmentOptions,
  listPlatformEmployeePostOptions,
  listPlatformEmployeeRoleOptions,
  requestPlatformUserPasswordReset,
  listPlatformEmployeeCandidates,
} from "@workspace/api-client"
import {
  PlatformEmployeeSchema,
  PlatformEmployeesPageSchema,
  PlatformEmployeeDepartmentOptionsPageSchema,
  PlatformEmployeePostOptionsPageSchema,
  PlatformEmployeeRoleOptionsPageSchema,
  type PlatformEmployeeOptionsQuery,
  PlatformEmployeeCandidatesPageSchema,
  type PlatformEmployee,
} from "@workspace/contracts/platform-system"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { ErrorState, LoadingState } from "@workspace/admin"
import {
  DataTable,
  createDataTableColumnHelper,
  createDataTableSelectColumn,
} from "@workspace/admin/data-table"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldError,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@workspace/ui/components/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@workspace/ui/components/dialog"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@workspace/ui/components/popover"
import { ArrowLeftIcon } from "lucide-react"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"
import { useUnlockPasswordLogin } from "../users/use-unlock-password-login"
import {
  PlatformExportButton,
  PlatformEmployeeImportButton,
} from "../tasks/task-actions"
import {
  directoryStatus,
  localizedDirectoryValidation,
  changeDirectorySelection,
  useRefreshPlatformAuthority,
} from "./employee-role-utils"
import {
  DirectoryPicker,
  DirectoryError,
  type DirectoryLoader,
  type DirectoryPage,
  type DirectoryOption,
} from "./employee-role-fields"

const columnsHelper = createDataTableColumnHelper<PlatformEmployee>()
const EMPTY_EMPLOYEES: PlatformEmployee[] = []
const assignmentSchema = z.object({
  departmentId: z.uuid().nullable(),
  postIds: z.array(z.uuid()).max(100),
  roleIds: z.array(z.uuid()).max(100),
})
const createSchema = assignmentSchema.extend({
  name: z.string().trim().min(1).max(200),
  email: z.email(),
  password: z.string().min(12).max(128),
})
const profileSchema = assignmentSchema
  .omit({ roleIds: true })
  .extend({ name: z.string().trim().min(1).max(200) })
const rolesSchema = assignmentSchema.pick({ roleIds: true })
const grantSchema = assignmentSchema.extend({ userId: z.uuid() })

type DirectoryKind = "department" | "post" | "role"
const employeeOptionLoaders: Record<
  DirectoryKind,
  (
    query: PlatformEmployeeOptionsQuery,
    signal: AbortSignal
  ) => Promise<DirectoryPage>
> = {
  department: async (query, signal) => {
    const data = PlatformEmployeeDepartmentOptionsPageSchema.parse(
      (await listPlatformEmployeeDepartmentOptions(query, { signal })).data
    )
    return {
      ...data,
      items: data.items.map((item) => ({
        id: item.id,
        name: item.name,
        detail: item.key,
      })),
    }
  },
  post: async (query, signal) => {
    const data = PlatformEmployeePostOptionsPageSchema.parse(
      (await listPlatformEmployeePostOptions(query, { signal })).data
    )
    return {
      ...data,
      items: data.items.map((item) => ({
        id: item.id,
        name: item.name,
        detail: item.key,
      })),
    }
  },
  role: async (query, signal) => {
    const data = PlatformEmployeeRoleOptionsPageSchema.parse(
      (await listPlatformEmployeeRoleOptions(query, { signal })).data
    )
    return {
      ...data,
      items: data.items.map((item) => ({
        id: item.id,
        name: item.name,
        detail: item.key,
      })),
    }
  },
}
const directoryLoaders: Record<DirectoryKind, DirectoryLoader> = {
  department: ({ q, page, pageSize }, signal) =>
    employeeOptionLoaders.department(
      { q, page, pageSize, status: "active" },
      signal
    ),
  post: ({ q, page, pageSize }, signal) =>
    employeeOptionLoaders.post({ q, page, pageSize, status: "active" }, signal),
  role: ({ q, page, pageSize }, signal) =>
    employeeOptionLoaders.role({ q, page, pageSize, status: "active" }, signal),
}
const filterLoaders: Record<"department" | "role", DirectoryLoader> = {
  department: ({ q, page, pageSize }, signal) =>
    employeeOptionLoaders.department({ q, page, pageSize }, signal),
  role: ({ q, page, pageSize }, signal) =>
    employeeOptionLoaders.role({ q, page, pageSize }, signal),
}
const selectedLoaders: Record<
  "department" | "role",
  (ids: string[], signal: AbortSignal) => Promise<DirectoryOption[]>
> = {
  department: async (ids, signal) =>
    (
      await employeeOptionLoaders.department(
        { ids: ids.join(","), page: 1, pageSize: 100 },
        signal
      )
    ).items,
  role: async (ids, signal) =>
    (
      await employeeOptionLoaders.role(
        { ids: ids.join(","), page: 1, pageSize: 100 },
        signal
      )
    ).items,
}

export function EmployeeDirectoryPicker({
  kind,
  selected,
  onChange,
  disabled,
  invalid,
  onBlur,
  initialOptions = [],
}: {
  kind: DirectoryKind
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  invalid?: boolean
  onBlur?: () => void
  initialOptions?: DirectoryOption[]
}) {
  const { t } = useTranslation("employees")
  const [knownOptions, setKnownOptions] = useState(initialOptions)
  return (
    <DirectoryPicker
      label={t(kind)}
      queryKey={`employee-form-active:${kind}`}
      selected={selected}
      onChange={onChange}
      loadPage={directoryLoaders[kind]}
      selectedOptions={knownOptions.filter((option) =>
        selected.includes(option.id)
      )}
      onOptionSelect={(option) =>
        setKnownOptions((previous) => [
          ...previous.filter((item) => item.id !== option.id),
          option,
        ])
      }
      multiple={kind !== "department"}
      disabled={disabled}
      invalid={invalid}
      onBlur={onBlur}
    />
  )
}

function EmployeeDirectoryFilter({
  kind,
  value,
  onChange,
}: {
  kind: "department" | "role"
  value?: string
  onChange: (id: string | undefined) => void
}) {
  const { t } = useTranslation("employees")
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>
        {t(kind)}
        {value && <Badge variant="secondary">1</Badge>}
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={t(kind)} className="w-80">
        <h2 className="mb-3 text-sm font-medium">{t(kind)}</h2>
        <DirectoryPicker
          label={t(kind)}
          queryKey={`employee-filter-all:${kind}`}
          selected={value ? [value] : []}
          onChange={(ids) => onChange(ids[0])}
          loadPage={filterLoaders[kind]}
          loadSelected={selectedLoaders[kind]}
          inline
          multiple={false}
        />
      </PopoverContent>
    </Popover>
  )
}

export function PlatformEmployeesPage() {
  const refreshAuthority = useRefreshPlatformAuthority()
  const { t } = useTranslation(["employees", "common"])
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const search = useSearch({ from: "/platform/employees" })
  const navigate = useNavigate({ from: "/platform/employees" })
  const queryClient = useQueryClient()
  const locale = useUiLocale()
  const [removing, setRemoving] = useState<PlatformEmployee[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const manage = platformAccess.permissions.includes(
    "platform.authorization:manage"
  )
  const query = useQuery({
    queryKey: ["platform", session.user.id, "employees", search],
    queryFn: async ({ signal }) =>
      PlatformEmployeesPageSchema.parse(
        (await listPlatformEmployees(search, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error ?? error)
  const columns = useMemo(
    () =>
      columnsHelper.columns([
        ...(manage ? [createDataTableSelectColumn<PlatformEmployee>()] : []),
        columnsHelper.accessor("name", {
          header: t("employees:name"),
          size: 210,
          cell: ({ row, getValue }) => (
            <Link
              to="/platform/employees/$employeeId"
              params={{ employeeId: row.original.userId }}
              className="font-medium underline-offset-4 hover:underline"
            >
              {getValue()}
            </Link>
          ),
          meta: { label: t("employees:name") },
        }),
        columnsHelper.accessor("maskedEmail", {
          header: t("employees:email"),
          size: 220,
          cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
          meta: { label: t("employees:email") },
        }),
        columnsHelper.accessor("status", {
          header: t("employees:status"),
          cell: ({ getValue }) => (
            <Badge variant={getValue() === "active" ? "secondary" : "outline"}>
              {t(`employees:${getValue()}`)}
            </Badge>
          ),
          meta: { label: t("employees:status") },
        }),
        columnsHelper.accessor("departmentId", {
          header: t("employees:department"),
          size: 180,
          cell: ({ row }) => (
            <EmployeeAssignmentNames
              options={row.original.department ? [row.original.department] : []}
            />
          ),
          meta: { label: t("employees:department") },
        }),
        columnsHelper.accessor("roleIds", {
          header: t("employees:role"),
          cell: ({ getValue }) =>
            t("employees:assignmentCount", { count: getValue().length }),
          meta: { label: t("employees:role") },
        }),
        columnsHelper.accessor("postIds", {
          header: t("employees:post"),
          cell: ({ getValue }) =>
            t("employees:assignmentCount", { count: getValue().length }),
          meta: { label: t("employees:post") },
        }),
        columnsHelper.accessor("createdAt", {
          header: t("employees:createdAt"),
          size: 180,
          cell: ({ getValue }) =>
            createFormatter(locale).dateTime(new Date(getValue()), "UTC", {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          meta: { label: t("employees:createdAt") },
        }),
        ...(manage
          ? [
              columnsHelper.display({
                id: "actions",
                header: t("employees:actions"),
                size: 90,
                cell: ({ row }) => (
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={pending}
                    onClick={() => {
                      setError(undefined)
                      setRemoving([row.original])
                    }}
                  >
                    {t("employees:remove")}
                  </Button>
                ),
                meta: { label: t("employees:actions"), configurable: false },
              }),
            ]
          : []),
      ]),
    [t, locale, manage, pending]
  )
  const pagination = { pageIndex: search.page - 1, pageSize: search.pageSize }
  return (
    <section className="min-w-0 space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {t("employees:title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("employees:description")}
        </p>
      </div>
      <DataTable
        columns={columns}
        data={query.data?.items ?? EMPTY_EMPLOYEES}
        getRowId={(row) => row.userId}
        rowCount={query.data?.total ?? 0}
        manualPagination
        manualFiltering
        manualSorting
        enableSorting={false}
        enableRowSelection={manage}
        isActionPending={pending}
        status={directoryStatus(query)}
        error={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
        searchPlaceholder={t("employees:search")}
        searchMaxLength={200}
        toolbarContent={
          <>
            {manage && (
              <>
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/platform/employees/new" />}
                >
                  {t("employees:create")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  nativeButton={false}
                  render={<Link to="/platform/employees/grant" />}
                >
                  {t("employees:grant")}
                </Button>
                <PlatformEmployeeImportButton />
              </>
            )}
            {platformAccess.permissions.includes(
              "platform.employee:export"
            ) && <PlatformExportButton resource="employee" filters={search} />}
          </>
        }
        toolbarFilters={
          <>
            <Select
              items={{
                all: t("employees:allStatuses"),
                active: t("employees:active"),
                disabled: t("employees:disabled"),
              }}
              value={search.status ?? "all"}
              onValueChange={(value) => {
                if (value)
                  void navigate({
                    search: {
                      ...search,
                      page: 1,
                      status:
                        value === "all"
                          ? undefined
                          : (value as "active" | "disabled"),
                    },
                  })
              }}
            >
              <SelectTrigger size="sm" aria-label={t("employees:status")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t("employees:allStatuses")}
                </SelectItem>
                <SelectItem value="active">{t("employees:active")}</SelectItem>
                <SelectItem value="disabled">
                  {t("employees:disabled")}
                </SelectItem>
              </SelectContent>
            </Select>
            <EmployeeDirectoryFilter
              kind="department"
              value={search.departmentId}
              onChange={(departmentId) =>
                void navigate({ search: { ...search, page: 1, departmentId } })
              }
            />
            <EmployeeDirectoryFilter
              kind="role"
              value={search.roleId}
              onChange={(roleId) =>
                void navigate({ search: { ...search, page: 1, roleId } })
              }
            />
          </>
        }
        state={{
          globalFilter: search.q ?? "",
          pagination,
          columnFilters: [
            ...(search.status ? [{ id: "status", value: search.status }] : []),
            ...(search.departmentId
              ? [{ id: "departmentId", value: search.departmentId }]
              : []),
            ...(search.roleId ? [{ id: "roleIds", value: search.roleId }] : []),
          ],
        }}
        onResetFilters={() =>
          void navigate({
            search: {
              ...search,
              page: 1,
              q: undefined,
              status: undefined,
              departmentId: undefined,
              roleId: undefined,
            },
          })
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
        renderSelectionActions={(rows) => (
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => {
              setError(undefined)
              setRemoving(rows.map((row) => row.original))
            }}
          >
            {t("employees:removeSelected", { count: rows.length })}
          </Button>
        )}
      />
      <Dialog
        open={removing.length > 0}
        onOpenChange={(open) => {
          if (!pending && !open) setRemoving([])
        }}
      >
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>
              {t("employees:removeTitle", { count: removing.length })}
            </DialogTitle>
            <DialogDescription>
              {t("employees:removeDescription")}
            </DialogDescription>
          </DialogHeader>
          <DirectoryError error={error} />
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setRemoving([])}
            >
              {t("common:cancel")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                setPending(true)
                setError(undefined)
                try {
                  if (removing.length === 1)
                    await deletePlatformEmployee(removing[0]!.userId)
                  else
                    await batchRemovePlatformEmployees({
                      userIds: removing.map((employee) => employee.userId),
                    })
                  setRemoving([])
                  await refreshAuthority()
                  await queryClient.invalidateQueries({
                    queryKey: ["platform", session.user.id, "employees"],
                  })
                } catch (failure) {
                  setError(failure)
                } finally {
                  setPending(false)
                }
              }}
            >
              {pending ? t("employees:saving") : t("employees:remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function EmployeePageHeader({ title }: { title: string }) {
  const { t } = useTranslation("employees")
  return (
    <header className="space-y-3">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={
          <Link
            to="/platform/employees"
            search={{
              page: 1,
              pageSize: 20,
              sortBy: "createdAt",
              sortOrder: "desc",
            }}
          />
        }
      >
        <ArrowLeftIcon />
        {t("back")}
      </Button>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
    </header>
  )
}

export function PlatformEmployeeCreatePage() {
  const { t } = useTranslation(["employees", "common"])
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const id = useId()
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      departmentId: null as string | null,
      postIds: [] as string[],
      roleIds: [] as string[],
    },
    validators: {
      onSubmit: localizedDirectoryValidation(createSchema, {
        name: t("employees:invalidName"),
        email: t("employees:invalidEmail"),
        password: t("employees:invalidPassword"),
        departmentId: t("employees:invalidSelection"),
        postIds: t("employees:invalidSelection"),
        roleIds: t("employees:invalidSelection"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        const employee = PlatformEmployeeSchema.parse(
          (await createPlatformEmployee({ mode: "create", ...value })).data
        )
        await queryClient.invalidateQueries({
          queryKey: ["platform", session.user.id, "employees"],
        })
        await navigate({
          to: "/platform/employees/$employeeId",
          params: { employeeId: employee.userId },
        })
      } catch (failure) {
        setError(failure)
      }
    },
  })
  return (
    <section className="max-w-4xl space-y-4">
      <EmployeePageHeader title={t("employees:create")} />
      <Card>
        <CardHeader>
          <CardDescription>{t("employees:createDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(pending) => (
              <form
                noValidate
                aria-busy={pending}
                onSubmit={(event) => {
                  event.preventDefault()
                  void form.handleSubmit()
                }}
              >
                <fieldset disabled={pending} className="space-y-5">
                  <FieldGroup className="gap-4">
                    {(["name", "email", "password"] as const).map((name) => (
                      <form.Field key={name} name={name}>
                        {(field) => {
                          const invalid =
                            field.state.meta.isTouched &&
                            !field.state.meta.isValid
                          return (
                            <Field data-invalid={invalid} className="max-w-lg">
                              <FieldLabel htmlFor={`${id}-${name}`}>
                                {t(`employees:${name}`)}
                              </FieldLabel>
                              <Input
                                id={`${id}-${name}`}
                                type={
                                  name === "name"
                                    ? "text"
                                    : name === "email"
                                      ? "email"
                                      : "password"
                                }
                                required
                                maxLength={
                                  name === "password"
                                    ? 128
                                    : name === "email"
                                      ? 254
                                      : 200
                                }
                                minLength={name === "password" ? 12 : undefined}
                                autoComplete={
                                  name === "password"
                                    ? "new-password"
                                    : name === "name"
                                      ? "name"
                                      : "off"
                                }
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                  field.handleChange(event.target.value)
                                }
                                aria-invalid={invalid}
                              />
                              {invalid && (
                                <FieldError errors={field.state.meta.errors} />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                    ))}
                    <FieldDescription>
                      {t("employees:verifiedAtCreation")}
                    </FieldDescription>
                    <form.Field name="departmentId">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("employees:department")}</FieldLabel>
                            <EmployeeDirectoryPicker
                              kind="department"
                              selected={
                                field.state.value ? [field.state.value] : []
                              }
                              onChange={(ids) =>
                                field.handleChange(ids[0] ?? null)
                              }
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                    <form.Field name="postIds" mode="array">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("employees:post")}</FieldLabel>
                            <EmployeeDirectoryPicker
                              kind="post"
                              selected={field.state.value}
                              onChange={(ids) =>
                                changeDirectorySelection(field, ids)
                              }
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                    <form.Field name="roleIds" mode="array">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("employees:role")}</FieldLabel>
                            <EmployeeDirectoryPicker
                              kind="role"
                              selected={field.state.value}
                              onChange={(ids) =>
                                changeDirectorySelection(field, ids)
                              }
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  </FieldGroup>
                  <DirectoryError error={error} />
                  <Button size="sm" type="submit">
                    {pending ? t("employees:saving") : t("employees:create")}
                  </Button>
                </fieldset>
              </form>
            )}
          </form.Subscribe>
        </CardContent>
      </Card>
    </section>
  )
}

export function PlatformEmployeeDetailPage() {
  const { t } = useTranslation("employees")
  const { employeeId } = useParams({ from: "/platform/employees/$employeeId" })
  const session = useAuthenticatedSession()!
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const query = useQuery({
    queryKey: ["platform", session.user.id, "employee", employeeId],
    queryFn: async ({ signal }) =>
      PlatformEmployeeSchema.parse(
        (await getPlatformEmployee(employeeId, { signal })).data
      ),
    retry: false,
  })
  usePlatformAccessFailure(query.error)
  if (query.isPending) return <LoadingState />
  if (query.isError)
    return (
      <ErrorState
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    )
  const employee = query.data
  return (
    <section className="max-w-4xl space-y-4">
      <EmployeePageHeader title={employee.name} />
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{t("profile")}</CardTitle>
            <CardDescription>
              <bdi>{employee.maskedEmail}</bdi>
            </CardDescription>
          </div>
          <Badge
            variant={employee.status === "active" ? "secondary" : "outline"}
          >
            {t(employee.status)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          {platformAccess.permissions.includes("platform.employee:update") ? (
            <EmployeeProfileForm
              key={`${employee.userId}-${employee.version}`}
              employee={employee}
              onSaved={() => void query.refetch()}
            />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("name")}</dt>
              <dd>{employee.name}</dd>
              <dt className="text-muted-foreground">{t("department")}</dt>
              <dd>
                <EmployeeAssignmentNames
                  options={employee.department ? [employee.department] : []}
                />
              </dd>
              <dt className="text-muted-foreground">{t("post")}</dt>
              <dd>
                <EmployeeAssignmentNames options={employee.posts} />
              </dd>
            </dl>
          )}
          <p className="text-xs text-muted-foreground">{t("nameOnly")}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("role")}</CardTitle>
          <CardDescription>{t("rolesDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {platformAccess.permissions.includes(
            "platform.authorization:manage"
          ) ? (
            <EmployeeRolesForm
              key={`${employee.userId}-${employee.version}`}
              employee={employee}
              onSaved={() => void query.refetch()}
            />
          ) : (
            <EmployeeAssignmentNames options={employee.roles} />
          )}
        </CardContent>
      </Card>
      <EmployeeStatusActions
        employee={employee}
        onSaved={() => void query.refetch()}
      />
    </section>
  )
}

export function EmployeeAssignmentNames({
  options,
}: {
  options: DirectoryOption[]
}) {
  const { t } = useTranslation("employees")
  if (!options.length)
    return <span className="text-muted-foreground">{t("unassigned")}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {options.map((option) => (
        <Badge key={option.id} variant="outline">
          {option.name}
        </Badge>
      ))}
    </span>
  )
}

function EmployeeProfileForm({
  employee,
  onSaved,
}: {
  employee: PlatformEmployee
  onSaved: () => void
}) {
  const { t } = useTranslation(["employees", "common"])
  const id = useId()
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: {
      name: employee.name,
      departmentId: employee.departmentId,
      postIds: employee.postIds,
    },
    validators: {
      onSubmit: localizedDirectoryValidation(profileSchema, {
        name: t("employees:invalidName"),
        departmentId: t("employees:invalidSelection"),
        postIds: t("employees:invalidSelection"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        await updatePlatformEmployee(employee.userId, {
          ...value,
          expectedVersion: employee.version,
        })
        onSaved()
      } catch (failure) {
        setError(failure)
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <form
          noValidate
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <FieldGroup className="gap-4">
              <form.Field name="name">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field className="max-w-lg" data-invalid={invalid}>
                      <FieldLabel htmlFor={id}>
                        {t("employees:name")}
                      </FieldLabel>
                      <Input
                        id={id}
                        required
                        maxLength={200}
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
              <form.Field name="departmentId">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel>{t("employees:department")}</FieldLabel>
                      <EmployeeDirectoryPicker
                        kind="department"
                        initialOptions={
                          employee.department ? [employee.department] : []
                        }
                        selected={field.state.value ? [field.state.value] : []}
                        onChange={(ids) => field.handleChange(ids[0] ?? null)}
                        onBlur={field.handleBlur}
                        disabled={pending}
                        invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
              <form.Field name="postIds" mode="array">
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  return (
                    <Field data-invalid={invalid}>
                      <FieldLabel>{t("employees:post")}</FieldLabel>
                      <EmployeeDirectoryPicker
                        kind="post"
                        initialOptions={employee.posts}
                        selected={field.state.value}
                        onChange={(ids) => changeDirectorySelection(field, ids)}
                        onBlur={field.handleBlur}
                        disabled={pending}
                        invalid={invalid}
                      />
                      {invalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                    </Field>
                  )
                }}
              </form.Field>
            </FieldGroup>
            <DirectoryError error={error} />
            <Button size="sm" type="submit">
              {pending ? t("employees:saving") : t("common:save")}
            </Button>
          </fieldset>
        </form>
      )}
    </form.Subscribe>
  )
}

function EmployeeRolesForm({
  employee,
  onSaved,
}: {
  employee: PlatformEmployee
  onSaved: () => void
}) {
  const refreshAuthority = useRefreshPlatformAuthority()
  const { t } = useTranslation(["employees", "common"])
  const [error, setError] = useState<unknown>()
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: { roleIds: employee.roleIds },
    validators: {
      onSubmit: localizedDirectoryValidation(rolesSchema, {
        roleIds: t("employees:invalidSelection"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        await setPlatformEmployeeRoles(employee.userId, {
          ...value,
          expectedVersion: employee.version,
        })
        await refreshAuthority()
        onSaved()
      } catch (failure) {
        setError(failure)
      }
    },
  })
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(pending) => (
        <form
          noValidate
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <form.Field name="roleIds" mode="array">
              {(field) => {
                const invalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={invalid}>
                    <FieldLabel>{t("employees:role")}</FieldLabel>
                    <EmployeeDirectoryPicker
                      kind="role"
                      initialOptions={employee.roles}
                      selected={field.state.value}
                      onChange={(ids) => changeDirectorySelection(field, ids)}
                      onBlur={field.handleBlur}
                      disabled={pending}
                      invalid={invalid}
                    />
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                  </Field>
                )
              }}
            </form.Field>
            <DirectoryError error={error} />
            <Button size="sm" type="submit">
              {pending ? t("employees:saving") : t("common:save")}
            </Button>
          </fieldset>
        </form>
      )}
    </form.Subscribe>
  )
}

function EmployeeStatusActions({
  employee,
  onSaved,
}: {
  employee: PlatformEmployee
  onSaved: () => void
}) {
  const refreshAuthority = useRefreshPlatformAuthority()
  const unlock = useUnlockPasswordLogin(employee.userId)
  const { t } = useTranslation("employees")
  const { platformAccess } = useRouteContext({ from: "/platform" })
  const [action, setAction] = useState<"status" | "reset" | "unlock" | null>(
    null
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>()
  const [sent, setSent] = useState(false)
  usePlatformAccessFailure(error)
  const label =
    action === "unlock"
      ? t("unlock")
      : action === "reset"
        ? t("resetPassword")
        : employee.status === "active"
          ? t("disable")
          : t("enable")
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t("employmentAndSecurity")}
        </CardTitle>
        <CardDescription>{t("employmentBoundary")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <EmployeeLoginLock employee={employee} />
        <div className="flex flex-wrap gap-2">
          {platformAccess.permissions.includes("platform.user:unlock") &&
            (employee.lockedUntil !== null || employee.failedAttempts > 0) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(undefined)
                  setAction("unlock")
                }}
              >
                {t("unlock")}
              </Button>
            )}
          {platformAccess.permissions.includes(
            "platform.authorization:manage"
          ) && (
            <Button
              variant={employee.status === "active" ? "destructive" : "outline"}
              size="sm"
              onClick={() => {
                setError(undefined)
                setAction("status")
              }}
            >
              {employee.status === "active" ? t("disable") : t("enable")}
            </Button>
          )}
          {platformAccess.permissions.includes(
            "platform.user:resetPassword"
          ) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(undefined)
                setAction("reset")
              }}
            >
              {t("resetPassword")}
            </Button>
          )}
        </div>
        {sent && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("resetSent")}
          </p>
        )}
        <Dialog
          open={action !== null}
          onOpenChange={(open) => {
            if (!open && !pending) setAction(null)
          }}
        >
          <DialogContent showCloseButton={!pending}>
            <DialogHeader>
              <DialogTitle>{label}</DialogTitle>
              <DialogDescription>
                {action === "unlock"
                  ? t("unlockDescription")
                  : action === "reset"
                    ? t("resetDescription")
                    : employee.status === "active"
                      ? t("disableDescription")
                      : t("enableDescription")}
              </DialogDescription>
            </DialogHeader>
            <DirectoryError error={error} />
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setAction(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                disabled={pending}
                variant={
                  action === "status" && employee.status === "active"
                    ? "destructive"
                    : "default"
                }
                onClick={async () => {
                  setPending(true)
                  setError(undefined)
                  try {
                    if (action === "unlock") {
                      await unlock.mutateAsync()
                    } else if (action === "reset") {
                      await requestPlatformUserPasswordReset(employee.userId)
                      setSent(true)
                    } else {
                      await setPlatformEmployeeStatus(employee.userId, {
                        status:
                          employee.status === "active" ? "disabled" : "active",
                        expectedVersion: employee.version,
                      })
                      await refreshAuthority()
                      onSaved()
                    }
                    setAction(null)
                  } catch (failure) {
                    setError(failure)
                  } finally {
                    setPending(false)
                  }
                }}
              >
                {pending ? t("saving") : label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function EmployeeLoginLock({ employee }: { employee: PlatformEmployee }) {
  const { t } = useTranslation("employees")
  const locale = useUiLocale()
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      <dt className="text-muted-foreground">{t("passwordLoginLock")}</dt>
      <dd>
        {employee.lockedUntil
          ? t("lockedUntil", {
              time: createFormatter(locale).dateTime(
                new Date(employee.lockedUntil),
                "UTC",
                { dateStyle: "medium", timeStyle: "short" }
              ),
            })
          : t("notLocked")}
      </dd>
      <dt className="text-muted-foreground">{t("failedAttempts")}</dt>
      <dd>{employee.failedAttempts}</dd>
    </dl>
  )
}

export function PlatformEmployeeGrantPage() {
  const { t } = useTranslation("employees")
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>()
  const [candidateNames, setCandidateNames] = useState<
    Record<string, DirectoryOption>
  >({})
  usePlatformAccessFailure(error)
  const form = useForm({
    defaultValues: {
      userId: "",
      departmentId: null as string | null,
      postIds: [] as string[],
      roleIds: [] as string[],
    },
    validators: {
      onSubmit: localizedDirectoryValidation(grantSchema, {
        userId: t("invalidAccount"),
        departmentId: t("invalidSelection"),
        postIds: t("invalidSelection"),
        roleIds: t("invalidSelection"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(undefined)
      try {
        const employee = PlatformEmployeeSchema.parse(
          (await createPlatformEmployee({ mode: "existing", ...value })).data
        )
        await queryClient.invalidateQueries({
          queryKey: ["platform", session.user.id, "employees"],
        })
        await navigate({
          to: "/platform/employees/$employeeId",
          params: { employeeId: employee.userId },
        })
      } catch (failure) {
        setError(failure)
      }
    },
  })
  const loadCandidates: DirectoryLoader = async (
    { q, page, pageSize },
    signal
  ) => {
    const data = PlatformEmployeeCandidatesPageSchema.parse(
      (await listPlatformEmployeeCandidates({ q, page, pageSize }, { signal }))
        .data
    )
    const options = data.items.map((item) => ({
      id: item.userId,
      name: item.name,
      detail: item.maskedEmail,
    }))
    return { ...data, items: options }
  }
  return (
    <section className="max-w-4xl space-y-4">
      <EmployeePageHeader title={t("grant")} />
      <Card>
        <CardHeader>
          <CardDescription>{t("grantDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(pending) => (
              <form
                noValidate
                aria-busy={pending}
                onSubmit={(event) => {
                  event.preventDefault()
                  void form.handleSubmit()
                }}
              >
                <fieldset disabled={pending} className="space-y-5">
                  <FieldGroup className="gap-4">
                    <form.Field name="userId">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("existingAccount")}</FieldLabel>
                            <DirectoryPicker
                              label={t("existingAccount")}
                              queryKey="employee-candidates"
                              selected={
                                field.state.value ? [field.state.value] : []
                              }
                              selectedOptions={
                                field.state.value &&
                                candidateNames[field.state.value]
                                  ? [candidateNames[field.state.value]!]
                                  : []
                              }
                              onChange={(ids) =>
                                field.handleChange(ids[0] ?? "")
                              }
                              loadPage={loadCandidates}
                              onOptionSelect={(option) =>
                                setCandidateNames((previous) => ({
                                  ...previous,
                                  [option.id]: option,
                                }))
                              }
                              multiple={false}
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                    <form.Field name="departmentId">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("department")}</FieldLabel>
                            <EmployeeDirectoryPicker
                              kind="department"
                              selected={
                                field.state.value ? [field.state.value] : []
                              }
                              onChange={(ids) =>
                                field.handleChange(ids[0] ?? null)
                              }
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                    <form.Field name="postIds" mode="array">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("post")}</FieldLabel>
                            <EmployeeDirectoryPicker
                              kind="post"
                              selected={field.state.value}
                              onChange={(ids) =>
                                changeDirectorySelection(field, ids)
                              }
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                    <form.Field name="roleIds" mode="array">
                      {(field) => {
                        const invalid =
                          field.state.meta.isTouched &&
                          !field.state.meta.isValid
                        return (
                          <Field data-invalid={invalid}>
                            <FieldLabel>{t("role")}</FieldLabel>
                            <EmployeeDirectoryPicker
                              kind="role"
                              selected={field.state.value}
                              onChange={(ids) =>
                                changeDirectorySelection(field, ids)
                              }
                              onBlur={field.handleBlur}
                              disabled={pending}
                              invalid={invalid}
                            />
                            {invalid && (
                              <FieldError errors={field.state.meta.errors} />
                            )}
                          </Field>
                        )
                      }}
                    </form.Field>
                  </FieldGroup>
                  <DirectoryError error={error} />
                  <Button size="sm" type="submit">
                    {pending ? t("saving") : t("grant")}
                  </Button>
                </fieldset>
              </form>
            )}
          </form.Subscribe>
        </CardContent>
      </Card>
    </section>
  )
}
