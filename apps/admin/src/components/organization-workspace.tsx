import { useTranslation } from "react-i18next"
import type { ReactNode } from "react"
import type { TFunction } from "@workspace/i18n"
import type { OrganizationSummary } from "@workspace/contracts"
import { useOrganizationWorkspace } from "@/hooks/use-organization-workspace"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { FormDialog, LocaleSwitcher } from "@workspace/admin"
import { useForm } from "@tanstack/react-form"
import { Link, Navigate } from "@tanstack/react-router"
import { GalleryVerticalEnd } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import * as z from "zod"

const createOrganizationSchema = (
  t: TFunction<["organization", "common", "validation"]>
) =>
  z.object({
    name: z.string().trim().min(1, t("validation:organizationName")),
    slug: z.string().trim().min(1, t("validation:organizationSlug")),
  })

function WorkspaceQueryStatus({
  workspace,
}: {
  workspace: ReturnType<typeof useOrganizationWorkspace>["workspace"]
}) {
  const { t } = useTranslation(["organization", "common"])

  if (workspace.isPending)
    return <p role="status">{t("organization:loading")}</p>
  if (workspace.isError) {
    return (
      <div className="space-y-4">
        <p role="alert">{workspace.error.message}</p>
        <Button
          disabled={workspace.isFetching}
          onClick={() => void workspace.refetch()}
        >
          {t("common:retry")}
        </Button>
      </div>
    )
  }
  return null
}

export function OrganizationUnavailable({
  organizations,
  currentId,
}: {
  organizations: readonly OrganizationSummary[]
  currentId?: string
}) {
  const { t } = useTranslation(["organization", "errors"])
  const alternatives = organizations.filter(
    (organization) =>
      organization.status === "ACTIVE" && organization.id !== currentId
  )
  return (
    <div className="space-y-4">
      <p role="alert">{t("errors:ORGANIZATION_SUSPENDED")}</p>
      <p>{t("organization:unavailableHint")}</p>
      {alternatives.length > 0 && (
        <nav aria-labelledby="switch-organization-heading">
          <h2 id="switch-organization-heading" className="sr-only">
            {t("organization:select")}
          </h2>
          <ul className="space-y-2">
            {alternatives.map((organization) => (
              <li key={organization.id}>
                <Link
                  to="/app/projects/$organizationId"
                  params={{ organizationId: organization.id }}
                  className="block rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted/50"
                >
                  {organization.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}

export function WorkspaceEntry() {
  const { workspace } = useOrganizationWorkspace()
  if (workspace.isPending || workspace.isError)
    return <WorkspaceQueryStatus workspace={workspace} />

  const organizations = workspace.data ?? []
  const only = organizations.length === 1 ? organizations[0] : undefined
  if (only?.status === "ACTIVE") {
    return (
      <Navigate
        to="/app/projects/$organizationId"
        params={{ organizationId: only.id }}
        replace
      />
    )
  }
  return <Navigate to="/app/select-organization" replace />
}

function useCreateOrganizationForm(
  createOrganization: (input: {
    name: string
    slug: string
  }) => Promise<string | undefined>,
  onCreated?: (organizationId: string) => void
) {
  const { t } = useTranslation(["organization", "common", "validation"])
  return useForm({
    defaultValues: { name: "", slug: "" },
    validators: {
      onSubmit: createOrganizationSchema(t),
    },
    onSubmit: async ({ value, formApi }) => {
      const organizationId = await createOrganization(value)
      if (!organizationId) return
      formApi.reset()
      onCreated?.(organizationId)
    },
  })
}

function CreateOrganizationFields({
  form,
}: {
  form: ReturnType<typeof useCreateOrganizationForm>
}) {
  const { t } = useTranslation(["organization", "validation"])
  return (
    <FieldGroup>
      <form.Field name="name">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor="organization-name">
                {t("organization:name")}
              </FieldLabel>
              <Input
                id="organization-name"
                name={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={isInvalid}
                required
              />
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          )
        }}
      </form.Field>
      <form.Field name="slug">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor="organization-slug">
                {t("organization:slug")}
              </FieldLabel>
              <Input
                id="organization-slug"
                name={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={isInvalid}
                required
              />
              <FieldDescription>{t("organization:slugHint")}</FieldDescription>
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          )
        }}
      </form.Field>
    </FieldGroup>
  )
}

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  createOrganization,
  pending,
  error,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  createOrganization: (input: {
    name: string
    slug: string
  }) => Promise<string | undefined>
  pending: boolean
  error?: string
  onCreated: (organizationId: string) => void
}) {
  const { t } = useTranslation(["organization", "common", "validation"])
  const form = useCreateOrganizationForm(
    createOrganization,
    (organizationId) => {
      onOpenChange(false)
      onCreated(organizationId)
    }
  )
  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(submitting) => (
        <FormDialog
          open={open}
          onOpenChange={onOpenChange}
          title={t("organization:create")}
          description={t("organization:slugHint")}
          onSubmit={() => void form.handleSubmit()}
          pending={pending || submitting}
          error={error}
          submitLabel={t("organization:create")}
        >
          <CreateOrganizationFields form={form} />
        </FormDialog>
      )}
    </form.Subscribe>
  )
}

function IdentityPage({
  title,
  actions,
  children,
}: {
  title: string
  actions: ReactNode
  children: ReactNode
}) {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              {title}
            </span>
          </div>
          {actions}
        </header>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <img
          src="/placeholder.svg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </main>
  )
}

export function OrganizationGate() {
  const { t } = useTranslation([
    "organization",
    "common",
    "validation",
    "auth",
    "errors",
  ])
  const session = useAuthenticatedSession()!
  const { workspace, pending, error, createOrganization } =
    useOrganizationWorkspace()
  // 进入门只根据已读回的组织数量跳转。创建成功但读回失败时停在查询错误，不能用返回的 id 抢先进入工作区。
  const form = useCreateOrganizationForm(createOrganization)
  const sessionFooter = (
    <div className="mt-6 flex flex-col items-center gap-2">
      {session.user.email && (
        <p className="w-full truncate text-center text-sm text-muted-foreground">
          {session.user.email}
        </p>
      )}
      <Button
        variant="ghost"
        disabled={session.signingOut}
        onClick={() => void session.signOut()}
      >
        {session.signingOut ? t("auth:signingOut") : t("auth:signOut")}
      </Button>
    </div>
  )

  if (workspace.isPending || workspace.isError) {
    return (
      <IdentityPage
        title={t("organization:management")}
        actions={<LocaleSwitcher align="end" />}
      >
        <WorkspaceQueryStatus workspace={workspace} />
        {sessionFooter}
      </IdentityPage>
    )
  }

  const organizations = workspace.data ?? []
  const only = organizations.length === 1 ? organizations[0] : undefined
  if (only?.status === "ACTIVE") {
    return (
      <Navigate
        to="/app/projects/$organizationId"
        params={{ organizationId: only.id }}
        replace
      />
    )
  }

  return (
    <IdentityPage
      title={t("organization:management")}
      actions={<LocaleSwitcher align="end" />}
    >
      {error && (
        <p role="alert" className="mb-4 text-center text-sm text-destructive">
          {error}
        </p>
      )}
      {organizations.length > 0 &&
        organizations.every(
          (organization) => organization.status === "SUSPENDED"
        ) && (
          <div className="mb-4">
            <OrganizationUnavailable organizations={organizations} />
          </div>
        )}
      {organizations.length === 0 ? (
        <section aria-labelledby="create-organization-heading">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void form.handleSubmit()
            }}
            className="flex flex-col gap-6"
            aria-busy={pending}
          >
            <fieldset disabled={pending} className="contents">
              <div className="flex flex-col items-center gap-1 text-center">
                <h1
                  id="create-organization-heading"
                  className="text-2xl font-bold"
                >
                  {t("organization:create")}
                </h1>
              </div>
              <CreateOrganizationFields form={form} />
              <Button type="submit" className="w-full">
                {pending ? t("common:submitting") : t("organization:create")}
              </Button>
            </fieldset>
          </form>
        </section>
      ) : (
        <nav
          className="space-y-6"
          aria-labelledby="select-organization-heading"
        >
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 id="select-organization-heading" className="text-2xl font-bold">
              {t("organization:select")}
            </h1>
          </div>
          <ul className="space-y-2">
            {organizations.map((organization) => (
              <li key={organization.id}>
                <Link
                  to="/app/projects/$organizationId"
                  params={{ organizationId: organization.id }}
                  className="block rounded-xl border px-4 py-3 text-sm font-medium hover:bg-muted/50"
                >
                  {organization.name}
                  {organization.status === "SUSPENDED" ? (
                    <span className="mt-1 block text-sm font-normal text-muted-foreground">
                      {t("errors:ORGANIZATION_SUSPENDED")}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {sessionFooter}
    </IdentityPage>
  )
}
