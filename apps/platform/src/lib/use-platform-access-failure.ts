import { useCallback, useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { authClient } from "./auth-client"
import { rejectPlatformAccess } from "./platform-access-failure"

export function usePlatformAccessFailure(error?: unknown) {
  const queryClient = useQueryClient()
  const session = useAuthenticatedSession()!
  const navigate = useNavigate()
  const { refetch } = authClient.useSession()
  const reject = useCallback(
    (failure: unknown) =>
      rejectPlatformAccess(failure, {
        queryClient,
        userId: session.user.id,
        restoreSession: refetch,
        exit: (destination) => navigate(destination),
      }),
    [navigate, queryClient, refetch, session.user.id]
  )
  useEffect(() => {
    void reject(error)
  }, [error, reject])
  return reject
}
