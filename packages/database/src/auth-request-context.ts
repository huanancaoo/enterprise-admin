import { AsyncLocalStorage } from "node:async_hooks"

export type AuthRequestContext = {
  requestId: string
  expectedAuthorizationVersion?: number
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
