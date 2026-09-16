import { useTranslation } from "react-i18next"
import { LocaleSwitcher } from "../components/workspace"
import type { TFunction } from "@workspace/i18n"
import { useState, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Navigate, useLocation } from "@tanstack/react-router"
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
import type { WorkspaceAuthClient } from "./client"
import { useAuthAction } from "./use-auth-action"

type AuthSessionProps = {
  client: WorkspaceAuthClient
  title: string
  allowSignUp?: boolean
  authenticatedPath: string
  children: ReactNode
}

function createCredentialsSchemas(
  t: TFunction<["auth", "common", "validation"]>
) {
  const signInSchema = z.object({
    name: z.string(),
    email: z.email(t("validation:email")),
    password: z
      .string()
      .min(1, t("validation:passwordRequired"))
      .max(128, t("validation:passwordMax")),
  })

  const signUpSchema = signInSchema.extend({
    name: z.string().trim().min(1, t("validation:nameRequired")),
    password: z
      .string()
      .min(8, t("validation:passwordMin"))
      .max(128, t("validation:passwordMax")),
  })

  return { signInSchema, signUpSchema }
}

export function AuthSession({
  client,
  title,
  allowSignUp = false,
  authenticatedPath,
  children,
}: AuthSessionProps) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const session = client.useSession()
  const pathname = useLocation({ select: (location) => location.pathname })

  if (session.isPending) {
    return (
      <main className="p-8" role="status">
        {t("auth:restoring")}
      </main>
    )
  }
  if (session.error) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p role="alert">{t("auth:restoreFailed")}</p>
        <Button onClick={() => void session.refetch()}>
          {t("common:retry")}
        </Button>
      </main>
    )
  }
  if (!session.data) {
    if (pathname !== "/login") return <Navigate to="/login" replace />
    return (
      <SessionQueryProvider key="anonymous">
        <AuthEntry client={client} title={title} allowSignUp={allowSignUp} />
      </SessionQueryProvider>
    )
  }
  if (pathname === "/login") return <Navigate to={authenticatedPath} replace />
  return (
    <SessionQueryProvider key={session.data.user.id}>
      <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-8 p-6 sm:p-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">{title}</p>
            <p className="text-sm break-all text-muted-foreground">
              {session.data.user.email}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LocaleSwitcher />
            <SignOut client={client} />
          </div>
        </header>
        {/* 用户变化时卸载组织页面，避免将前一个用户的表单状态带入新会话。 */}
        <section key={session.data.user.id}>{children}</section>
      </main>
    </SessionQueryProvider>
  )
}

function SessionQueryProvider({ children }: { children: ReactNode }) {
  // 每个账号使用独立 QueryClient；登出或换账号后不复用旧组织缓存。
  const [queryClient] = useState(() => new QueryClient())
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function AuthEntry({
  client,
  title,
  allowSignUp,
}: Pick<AuthSessionProps, "client" | "title" | "allowSignUp">) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const [signUp, setSignUp] = useState(false)
  // 请求状态由入口持有，模式切换不能卸载提交锁并启动竞争会话的第二个请求。
  const action = useAuthAction()
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <section className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex justify-end">
          <LocaleSwitcher align="end" />
        </div>
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <h1 className="text-2xl font-semibold">
            {signUp ? t("auth:signUp") : t("auth:signIn")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {signUp ? t("auth:signUpDescription") : t("auth:signInDescription")}
          </p>
        </header>
        <CredentialsForm
          key={String(signUp)}
          client={client}
          signUp={signUp}
          action={action}
        />
        {allowSignUp && (
          <Button
            variant="link"
            className="w-full"
            disabled={action.pending}
            onClick={() => {
              action.reset()
              setSignUp(!signUp)
            }}
          >
            {signUp ? t("auth:existingAccount") : t("auth:signUp")}
          </Button>
        )}
      </section>
    </main>
  )
}

function CredentialsForm({
  client,
  signUp,
  action,
}: {
  client: WorkspaceAuthClient
  signUp: boolean
  action: ReturnType<typeof useAuthAction>
}) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const { signInSchema, signUpSchema } = createCredentialsSchemas(t)
  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: {
      onSubmit: signUp ? signUpSchema : signInSchema,
    },
    onSubmit: async ({ value }) => {
      const credentials = {
        email: value.email.trim(),
        password: value.password,
      }
      await action.run(() =>
        signUp
          ? client.signUp.email({ ...credentials, name: value.name.trim() })
          : client.signIn.email(credentials)
      )
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className="space-y-4"
      aria-busy={action.pending}
    >
      <fieldset disabled={action.pending}>
        <FieldGroup>
          {signUp && (
            <form.Field name="name">
              {(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor="auth-name">
                      {t("auth:name")}
                    </FieldLabel>
                    <Input
                      id="auth-name"
                      name={field.name}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      autoComplete="name"
                      aria-invalid={isInvalid}
                      required
                    />
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            </form.Field>
          )}
          <form.Field name="email">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="auth-email">
                    {t("auth:email")}
                  </FieldLabel>
                  <Input
                    id="auth-email"
                    name={field.name}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    type="email"
                    autoComplete="email"
                    aria-invalid={isInvalid}
                    required
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="password">
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor="auth-password">
                    {t("auth:password")}
                  </FieldLabel>
                  <Input
                    id="auth-password"
                    name={field.name}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    type="password"
                    autoComplete={signUp ? "new-password" : "current-password"}
                    minLength={signUp ? 8 : undefined}
                    maxLength={128}
                    aria-invalid={isInvalid}
                    required
                  />
                  {signUp && (
                    <FieldDescription>
                      {t("auth:passwordHint")}
                    </FieldDescription>
                  )}
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              )
            }}
          </form.Field>
          {action.error && (
            <p role="alert" className="text-sm text-destructive">
              {action.error}
            </p>
          )}
          <Button type="submit" className="w-full">
            {action.pending
              ? t("common:submitting")
              : signUp
                ? t("auth:register")
                : t("auth:signIn")}
          </Button>
        </FieldGroup>
      </fieldset>
    </form>
  )
}

function SignOut({ client }: { client: WorkspaceAuthClient }) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const action = useAuthAction()
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={action.pending}
        onClick={() => void action.run(() => client.signOut())}
      >
        {action.pending ? t("auth:signingOut") : t("auth:signOut")}
      </Button>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </div>
  )
}
