import { useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { ApiClientError } from "@workspace/api-client"
import { authClient } from "./auth-client"
import { rejectPlatformAccess } from "./platform-access-failure"

export function usePlatformAccessFailure(error?: unknown) {
  const queryClient = useQueryClient()
  const session = useAuthenticatedSession()!
  const navigate = useNavigate()
  const router = useRouter()
  const { refetch } = authClient.useSession()
  const reject = useCallback(
    async (failure: unknown) => {
      if (failure instanceof ApiClientError && failure.status === 403) {
        // 动作拒绝不等于任职撤销；由既有平台入口重读身份，再决定是否离开后台。
        await router.invalidate()
        return false
      }
      return rejectPlatformAccess(failure, {
        queryClient,
        userId: session.user.id,
        restoreSession: refetch,
        exit: (destination) => navigate(destination),
      })
    },
    [navigate, queryClient, refetch, router, session.user.id]
  )
  useEffect(() => {
    void reject(error)
  }, [error, reject])
  return reject
}
