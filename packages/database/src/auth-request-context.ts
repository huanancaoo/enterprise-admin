import { AsyncLocalStorage } from "node:async_hooks"

export type AuthRequestContext = {
  requestId: string
  clientIp?: string
  userAgent?: string
  // CLI 创建平台管理员走同一套 signUp，但不能投递验证邮件。
  suppressAuthEmail?: boolean
  loginAttempt?: {
    method: "email" | "github" | "totp"
    email?: string
  }
  loginAuditPromise?: Promise<void>
}

const authRequestContext = new AsyncLocalStorage<AuthRequestContext>()

export function runWithAuthRequestContext<T>(
  context: AuthRequestContext,
  work: () => T | Promise<T>
): Promise<T> {
  return authRequestContext.run(context, async () => {
    try {
      return await work()
    } finally {
      await context.loginAuditPromise
    }
  })
}

export function getAuthRequestContext() {
  return authRequestContext.getStore()
}

export function setLoginAttempt(
  attempt: AuthRequestContext["loginAttempt"]
) {
  const context = authRequestContext.getStore()
  if (context) context.loginAttempt = attempt
}

export function takeLoginAttempt() {
  const context = authRequestContext.getStore()
  if (!context) return undefined
  const attempt = context.loginAttempt
  delete context.loginAttempt
  return attempt
}

export function setLoginAuditPromise(promise: Promise<void>) {
  const context = authRequestContext.getStore()
  if (context) context.loginAuditPromise = promise
}
