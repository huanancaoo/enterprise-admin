import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "@tanstack/react-router"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import type { z } from "zod"
import { ApiClientError } from "@workspace/api-client"
import type { DataTableStatus } from "@workspace/admin/data-table"

export function directoryStatus(query: {
  isError: boolean
  error: unknown
  isPending: boolean
  isFetching: boolean
}): DataTableStatus {
  if (query.isError)
    return query.error instanceof ApiClientError && query.error.status === 403
      ? "forbidden"
      : "error"
  if (query.isPending) return "loading"
  return query.isFetching ? "refreshing" : "ready"
}

export function localizedDirectoryValidation<T>(
  schema: z.ZodType<T>,
  messages: Record<string, string>
) {
  return ({ value }: { value: T }) => {
    const result = schema.safeParse(value)
    if (result.success) return undefined
    return {
      fields: Object.fromEntries(
        result.error.issues.map((issue) => [
          String(issue.path[0]),
          { message: messages[String(issue.path[0])]! },
        ])
      ),
    }
  }
}

export function changeDirectorySelection(
  field: {
    state: { value: string[] }
    removeValue: (index: number) => unknown
    pushValue: (value: string) => unknown
  },
  next: string[]
) {
  const current = field.state.value
  for (let index = current.length - 1; index >= 0; index--) {
    if (!next.includes(current[index]!)) void field.removeValue(index)
  }
  for (const id of next) {
    if (!current.includes(id)) void field.pushValue(id)
  }
}

/** 允许自我降权；写入成功后由平台根路由重读身份并决定去向，不在页面猜测剩余权限。 */
export function useRefreshPlatformAuthority() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const session = useAuthenticatedSession()!
  return useCallback(async () => {
    await router.invalidate()
    await queryClient.invalidateQueries({
      queryKey: ["platform", session.user.id, "navigation"],
    })
  }, [router, queryClient, session.user.id])
}
