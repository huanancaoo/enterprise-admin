import { useState, type ReactNode } from "react"
import { useForm } from "@tanstack/react-form"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Navigate, useLocation } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import type { WorkspaceAuthClient } from "./client"
import { useAuthAction } from "./use-auth-action"

type AuthSessionProps = {
  client: WorkspaceAuthClient
  title: string
  allowSignUp?: boolean
  authenticatedPath: string
  children: ReactNode
}

export function AuthSession({
  client,
  title,
  allowSignUp = false,
  authenticatedPath,
  children,
}: AuthSessionProps) {
  const session = client.useSession()
  const pathname = useLocation({ select: (location) => location.pathname })

  if (session.isPending) {
    return (
      <main className="p-8" role="status">
        正在恢复会话…
      </main>
    )
  }
  if (session.error) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p role="alert">无法恢复会话，请重试。</p>
        <Button onClick={() => void session.refetch()}>重试</Button>
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
          <SignOut client={client} />
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
  const [signUp, setSignUp] = useState(false)
  // 请求状态由入口持有，模式切换不能卸载提交锁并启动竞争会话的第二个请求。
  const action = useAuthAction()
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <section className="w-full max-w-sm space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <h1 className="text-2xl font-semibold">
            {signUp ? "创建账号" : "登录"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {signUp
              ? "创建账号后，选择或创建你的组织。"
              : "使用邮箱和密码登录你的账号。"}
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
            {signUp ? "已有账号，去登录" : "创建账号"}
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
  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
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
      <fieldset disabled={action.pending} className="space-y-4">
        {signUp && (
          <div className="space-y-2">
            <Label htmlFor="auth-name">姓名</Label>
            <form.Field name="name">
              {(field) => (
                <Input
                  id="auth-name"
                  name={field.name}
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  autoComplete="name"
                  required
                  pattern=".*\S.*"
                />
              )}
            </form.Field>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="auth-email">邮箱</Label>
          <form.Field name="email">
            {(field) => (
              <Input
                id="auth-email"
                name={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                type="email"
                autoComplete="email"
                required
              />
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <Label htmlFor="auth-password">密码</Label>
          <form.Field name="password">
            {(field) => (
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
                required
              />
            )}
          </form.Field>
          {signUp && (
            <p className="text-xs text-muted-foreground">
              密码需为 8–128 个字符。
            </p>
          )}
        </div>
        {action.error && (
          <p role="alert" className="text-sm text-destructive">
            {action.error}
          </p>
        )}
        <Button type="submit" className="w-full">
          {action.pending ? "提交中…" : signUp ? "注册" : "登录"}
        </Button>
      </fieldset>
    </form>
  )
}

function SignOut({ client }: { client: WorkspaceAuthClient }) {
  const action = useAuthAction()
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        disabled={action.pending}
        onClick={() => void action.run(() => client.signOut())}
      >
        {action.pending ? "正在退出…" : "退出登录"}
      </Button>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error}
        </p>
      )}
    </div>
  )
}
