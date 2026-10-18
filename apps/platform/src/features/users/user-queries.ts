import { useQueryClient } from "@tanstack/react-query"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { getPlatformUser, listPlatformUsers } from "@workspace/api-client"
import {
  PlatformUserDetailSchema,
  PlatformUsersPageSchema,
  type PlatformUserDetail,
  type PlatformUsersQuery,
  type PlatformUsersPage,
} from "@workspace/contracts/platform"
import type {
  PasswordLoginUnlockResult,
  PlatformUserMutationResult,
} from "@workspace/contracts/identity-management"
import { authClient } from "../../lib/auth-client"

function userReadScope(actorId: string) {
  return ["platform", actorId, "users"] as const
}

/** 所有普通用户投影共用身份范围；完整邮箱仍只由显式敏感读取获取。 */
export function platformUserQueries(actorId: string) {
  const scope = userReadScope(actorId)
  return {
    page: (search: PlatformUsersQuery) => ({
      queryKey: [...scope, "page", search] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        PlatformUsersPageSchema.parse(
          (await listPlatformUsers(search, { signal })).data
        ),
      retry: false,
    }),
    directory: (search: Pick<PlatformUsersQuery, "q" | "pageSize">) => ({
      queryKey: [...scope, "directory", search] as const,
      initialPageParam: 1,
      queryFn: async ({
        signal,
        pageParam,
      }: {
        signal: AbortSignal
        pageParam: number
      }) =>
        PlatformUsersPageSchema.parse(
          (await listPlatformUsers({ ...search, page: pageParam }, { signal }))
            .data
        ),
      getNextPageParam: (lastPage: PlatformUsersPage) =>
        lastPage.page * lastPage.pageSize < lastPage.total
          ? lastPage.page + 1
          : undefined,
      retry: false,
    }),
    detail: (userId: string) => ({
      queryKey: [...scope, "detail", userId] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        PlatformUserDetailSchema.parse(
          (await getPlatformUser(userId, { signal })).data
        ),
      retry: false,
    }),
  }
}

export function usePlatformUserChanges() {
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const nativeSession = authClient.useSession()
  const scope = userReadScope(session.user.id)
  const queries = platformUserQueries(session.user.id)

  async function publish(
    userId: string,
    update: (
      current: PlatformUserDetail | undefined
    ) => PlatformUserDetail | undefined
  ) {
    // 先取消旧读取，避免保存前发出的响应覆盖新事实；活跃目录、详情和已选标签随后一起重读。
    await queryClient.cancelQueries({ queryKey: scope })
    queryClient.setQueryData<PlatformUserDetail>(
      queries.detail(userId).queryKey,
      update
    )
    await queryClient.invalidateQueries({ queryKey: scope })
  }

  return {
    created: async (user: PlatformUserDetail) =>
      publish(user.userId, () => user),
    updated: async (result: PlatformUserMutationResult) => {
      await publish(result.userId, (current) =>
        current
          ? {
              ...current,
              name: result.name,
              status: result.status,
              version: result.version,
            }
          : current
      )
      if (result.userId === session.user.id)
        void nativeSession.refetch({ query: { disableCookieCache: true } })
    },
    unlocked: async (result: PasswordLoginUnlockResult) => {
      await publish(result.userId, (current) =>
        current ? { ...current, lockedUntil: result.lockedUntil } : current
      )
      // 员工和登录日志也展示同一密码锁事实，刷新范围不应由发起操作的页面决定。
      await Promise.all(
        [
          ["login-events"],
          ["employee", result.userId],
          ["employees"],
          ["role-employees"],
        ].map((key) =>
          queryClient.invalidateQueries({
            queryKey: ["platform", session.user.id, ...key],
          })
        )
      )
    },
  }
}
