import { AsyncLocalStorage } from "node:async_hooks"
import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import type { Pool } from "pg"

export type AuthRequestContext = {
  requestId: string
  clientIp?: string
  userAgent?: string
  // CLI 创建平台管理员走同一套 signUp，但不能投递验证邮件。
  suppressAuthEmail?: boolean
}

type LoginAttempt = {
  method: "email" | "github" | "totp"
  email?: string
}

type AuthRequestState = {
  context: AuthRequestContext
  attempt?: LoginAttempt
  pendingAudit?: Promise<void>
}

const authRequestContext = new AsyncLocalStorage<AuthRequestState>()

export function runWithAuthRequestContext<T>(
  context: AuthRequestContext,
  work: () => T | Promise<T>
): Promise<T> {
  const state: AuthRequestState = { context }
  return authRequestContext.run(state, async () => {
    try {
      return await work()
    } finally {
      // Better Auth 不等待 onAPIError；请求作用域负责等待已启动的失败审计。
      await state.pendingAudit
    }
  })
}

export function getAuthRequestContext() {
  return authRequestContext.getStore()?.context
}

function takeAttempt() {
  const state = authRequestContext.getStore()
  if (!state) return undefined
  const attempt = state.attempt
  delete state.attempt
  return attempt
}

function reportUnavailable() {
  console.error({
    event: "login.audit.unavailable",
    requestId: getAuthRequestContext()?.requestId,
  })
}

export function createLoginAudit(pool: Pick<Pool, "query">) {
  async function recordLoginEvent(input: {
    userId?: string | null
    email?: string | null
    method: "email" | "github" | "totp"
    result: "succeeded" | "failed"
    reason?: string | null
  }) {
    const request = getAuthRequestContext()
    await pool.query(
      "SELECT public.record_login_event($1::uuid, $2, $3, $4, $5, $6, $7, $8)",
      [
        input.userId ?? null,
        input.email ?? null,
        input.method,
        input.result,
        input.reason ?? null,
        request?.clientIp ?? null,
        request?.userAgent ?? null,
        request?.requestId ?? null,
      ]
    )
  }

  function loginFailureReason(error: unknown) {
    const value = error as {
      body?: { code?: unknown }
      code?: unknown
      message?: unknown
    }
    const candidate =
      typeof value?.body?.code === "string"
        ? value.body.code
        : typeof value?.message === "string"
          ? value.message
          : typeof value?.code === "string"
            ? value.code
            : ""
    if (
      candidate === "ACCOUNT_SUSPENDED" ||
      candidate === "PASSWORD_LOGIN_LOCKED"
    )
      return candidate
    if (candidate === "AUTHORIZATION_UNAVAILABLE") return candidate
    if (candidate === "INVALID_EMAIL_OR_PASSWORD") return "INVALID_CREDENTIALS"
    if (candidate === "EMAIL_NOT_VERIFIED") return candidate
    if (
      candidate === "INVALID_CODE" ||
      candidate === "INVALID_TOTP" ||
      candidate === "INVALID_BACKUP_CODE"
    )
      return "INVALID_OTP"
    return "AUTHENTICATION_FAILED"
  }

  const plugin = {
    id: "terminal-login-audit",
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            // 终态和 onError 都可能被调用；必须在首次 await 前消费，保证一次尝试只记一次。
            const attempt = takeAttempt()
            if (!attempt) return
            const result = ctx.context.returned
            if (result instanceof APIError) {
              await recordLoginEvent({
                email: attempt.email,
                method: attempt.method,
                result: "failed",
                reason: loginFailureReason(result),
              }).catch(reportUnavailable)
              return
            }
            const session = ctx.context.newSession
            if (!session) return
            try {
              await recordLoginEvent({
                userId: session.user.id,
                email: session.user.email,
                method: attempt.method,
                result: "succeeded",
              })
            } catch {
              await ctx.context.internalAdapter.deleteSession(
                session.session.token
              )
              throw new APIError(503, {
                code: "AUDIT_UNAVAILABLE",
                message: "AUDIT_UNAVAILABLE",
              })
            }
          }),
        },
      ],
    },
  } as BetterAuthPlugin

  return {
    attempt(attempt: LoginAttempt) {
      const state = authRequestContext.getStore()
      if (state) state.attempt = attempt
    },
    onError(error: unknown): void {
      const attempt = takeAttempt()
      if (!attempt) return
      const state = authRequestContext.getStore()!
      state.pendingAudit = recordLoginEvent({
        userId: null,
        email: attempt.email,
        method: attempt.method,
        result: "failed",
        reason: loginFailureReason(error),
      }).catch(reportUnavailable)
    },
    plugin,
  }
}
