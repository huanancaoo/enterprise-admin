import { AsyncLocalStorage } from "node:async_hooks"

export type AuthRequestContext = {
  requestId: string
  expectedAuthorizationVersion?: number
  // CLI 创建平台管理员走同一套 signUp，但不能投递验证邮件。
  suppressAuthEmail?: boolean
}

const authRequestContext = new AsyncLocalStorage<AuthRequestContext>()

export function runWithAuthRequestContext<T>(
  context: AuthRequestContext,
  work: () => T
): T {
  return authRequestContext.run(context, work)
}

export function getAuthRequestContext() {
  return authRequestContext.getStore()
}
