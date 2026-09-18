import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { useState, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Link, Navigate, useLocation } from "@tanstack/react-router"
import { Eye, EyeOff } from "lucide-react"
import { cn } from "cn"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import * as z from "zod"
import {
  AuthenticatedSessionContext,
  type AuthenticatedSession,
} from "./authenticated-session"
import { AuthClientContext } from "./auth-client-context"
import { AuthPageShell } from "./auth-page-shell"
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

function isAnonymousAuthPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname === "/auth/verified" ||
    pathname.startsWith("/accept-invitation/")
  )
}

function invitationRedirect(searchStr: string) {
  const query = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr
  const redirect = new URLSearchParams(query).get("redirect")
  if (redirect && /^\/accept-invitation\/[0-9a-f-]+$/.test(redirect)) {
    return redirect
  }
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
  const searchStr = useLocation({ select: (location) => location.searchStr })
  // Better Auth 在匿名 refetch（含注册成功）会把 isPending 设回 true；不能卸载入口，否则查收邮件等本地状态会丢。
  const [sessionSettled, setSessionSettled] = useState(false)
  if (!session.isPending && !sessionSettled) setSessionSettled(true)

  if (session.isPending && !sessionSettled) {
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
    if (!isAnonymousAuthPath(pathname)) return <Navigate to="/login" replace />
    return (
      <AuthClientContext.Provider value={client}>
        <SessionQueryProvider key="anonymous">
          {pathname === "/login" ? (
            <AuthEntry
              client={client}
              title={title}
              allowSignUp={allowSignUp}
            />
          ) : (
            children
          )}
        </SessionQueryProvider>
      </AuthClientContext.Provider>
    )
  }
  if (pathname === "/login") {
    const redirect = invitationRedirect(searchStr)
    if (redirect) return <Navigate to={redirect as never} replace />
    return <Navigate to={authenticatedPath} replace />
  }
  return (
    <AuthClientContext.Provider value={client}>
      <SessionQueryProvider key={session.data.user.id}>
        <AuthenticatedSessionProvider client={client} user={session.data.user}>
          {/* 用户变化时卸载组织页面，避免将前一个用户的表单状态带入新会话。 */}
          <section key={session.data.user.id}>{children}</section>
        </AuthenticatedSessionProvider>
      </SessionQueryProvider>
    </AuthClientContext.Provider>
  )
}

function AuthenticatedSessionProvider({
  client,
  user,
  children,
}: {
  client: WorkspaceAuthClient
  user: AuthenticatedSession["user"]
  children: ReactNode
}) {
  const action = useAuthAction()
  return (
    <AuthenticatedSessionContext.Provider
      value={{
        user,
        signingOut: action.pending,
        signOutError: action.error,
        signOut: () => void action.run(() => client.signOut()),
      }}
    >
      {children}
    </AuthenticatedSessionContext.Provider>
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
  allowSignUp = false,
}: Pick<AuthSessionProps, "client" | "title" | "allowSignUp">) {
  const [signUp, setSignUp] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)
  // 请求状态由入口持有，模式切换不能卸载提交锁并启动竞争会话的第二个请求。
  const action = useAuthAction()
  const { t } = useTranslation("auth")
  return (
    <AuthPageShell title={title}>
      {checkEmail ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-bold">{t("checkEmailTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("checkEmailDescription")}
          </p>
          <Button
            onClick={() => {
              action.reset()
              setCheckEmail(false)
              setSignUp(false)
            }}
          >
            {t("goToSignIn")}
          </Button>
        </div>
      ) : (
        <CredentialsForm
          key={String(signUp)}
          client={client}
          signUp={signUp}
          action={action}
          allowSignUp={allowSignUp}
          onSignedUp={() => setCheckEmail(true)}
          onToggleSignUp={() => {
            action.reset()
            setSignUp(!signUp)
          }}
        />
      )}
    </AuthPageShell>
  )
}

function CredentialsForm({
  client,
  signUp,
  action,
  allowSignUp,
  onToggleSignUp,
  onSignedUp,
}: {
  client: WorkspaceAuthClient
  signUp: boolean
  action: ReturnType<typeof useAuthAction>
  allowSignUp: boolean
  onToggleSignUp: () => void
  onSignedUp: () => void
}) {
  const { t } = useTranslation(["auth", "common", "validation"])
  const [showPassword, setShowPassword] = useState(false)
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
      const ok = await action.run(() =>
        signUp
          ? client.signUp.email({
              ...credentials,
              name: value.name.trim(),
              callbackURL: `${window.location.origin}/auth/verified`,
            })
          : client.signIn.email(credentials)
      )
      if (ok && signUp) onSignedUp()
    },
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
      className={cn("flex flex-col gap-6")}
      aria-busy={action.pending}
    >
      <fieldset disabled={action.pending} className="contents">
        <FieldGroup>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">
              {signUp ? t("auth:signUp") : t("auth:signIn")}
            </h1>
            <p className="text-sm text-balance text-muted-foreground">
              {signUp
                ? t("auth:signUpDescription")
                : t("auth:signInDescription")}
            </p>
          </div>
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
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="auth-password">
                      {t("auth:password")}
                    </FieldLabel>
                    {!signUp && (
                      <Link
                        to="/forgot-password"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        {t("auth:forgotPassword")}
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="auth-password"
                      name={field.name}
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                      onBlur={field.handleBlur}
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        signUp ? "new-password" : "current-password"
                      }
                      minLength={signUp ? 8 : undefined}
                      maxLength={128}
                      aria-invalid={isInvalid}
                      required
                      className="pe-9"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute end-0 top-0 h-full w-9 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword
                          ? t("auth:hidePassword")
                          : t("auth:showPassword")
                      }
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
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
            <p role="alert" className="text-center text-sm text-destructive">
              {action.error}
            </p>
          )}
          <Field>
            <Button type="submit" className="w-full">
              {action.pending
                ? t("common:submitting")
                : signUp
                  ? t("auth:register")
                  : t("auth:signIn")}
            </Button>
          </Field>
          {!signUp && (
            <>
              <FieldSeparator>{t("auth:orContinueWith")}</FieldSeparator>
              <Field>
                <Button
                  variant="outline"
                  type="button"
                  className="w-full cursor-not-allowed opacity-80"
                  title={t("auth:featureUnavailable")}
                  onClick={(event) => event.preventDefault()}
                  aria-disabled="true"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="mr-2 size-4 fill-current"
                    aria-hidden="true"
                  >
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                  </svg>
                  {t("auth:loginWithGithub")}
                </Button>
              </Field>
            </>
          )}
          {allowSignUp && (
            <FieldDescription className="text-center">
              {signUp ? (
                <Button
                  variant="link"
                  type="button"
                  className="h-auto p-0 font-normal underline underline-offset-4"
                  disabled={action.pending}
                  onClick={onToggleSignUp}
                >
                  {t("auth:existingAccount")}
                </Button>
              ) : (
                <>
                  {t("auth:noAccountPrompt")}{" "}
                  <Button
                    variant="link"
                    type="button"
                    className="h-auto p-0 font-normal underline underline-offset-4"
                    disabled={action.pending}
                    onClick={onToggleSignUp}
                  >
                    {t("auth:signUp")}
                  </Button>
                </>
              )}
            </FieldDescription>
          )}
        </FieldGroup>
      </fieldset>
    </form>
  )
}
