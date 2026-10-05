import type { QueryClient } from "@tanstack/react-query"
import { ApiClientError } from "@workspace/api-client"

export type PlatformAccessDestination =
  | { to: "/platform/access-denied" }
  | { to: "/login" }
  | { to: "/platform/mfa"; search: { challenge: false } }

type PlatformAccessAdapter = {
  queryClient: QueryClient
  userId: string
  restoreSession: () => void | Promise<unknown>
  exit: (destination: PlatformAccessDestination) => void | Promise<void>
}

export async function rejectPlatformAccess(
  error: unknown,
  adapter: PlatformAccessAdapter
): Promise<boolean> {
  if (!(error instanceof ApiClientError) || ![401, 403].includes(error.status))
    return false
  const queryKey = ["platform", adapter.userId]
  // 先取消再移除，避免仍在进行的受保护读取把失效数据写回缓存。
  await adapter.queryClient.cancelQueries({ queryKey })
  adapter.queryClient.removeQueries({ queryKey })
  if (error.status === 401) {
    await adapter.restoreSession()
    await adapter.exit({ to: "/login" })
  } else if (error.body.code === "PLATFORM_MFA_REQUIRED") {
    await adapter.exit({ to: "/platform/mfa", search: { challenge: false } })
  } else await adapter.exit({ to: "/platform/access-denied" })
  return true
}
