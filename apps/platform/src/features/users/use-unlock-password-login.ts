import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { unlockPlatformUserPasswordLogin } from "@workspace/api-client"
import { PasswordLoginUnlockResultSchema } from "@workspace/contracts/identity-management"
import type {
  PlatformUserDetail,
  PlatformUsersPage,
} from "@workspace/contracts/platform"

export function useUnlockPasswordLogin(userId: string) {
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () =>
      PasswordLoginUnlockResultSchema.parse(
        (await unlockPlatformUserPasswordLogin(userId)).data
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData<PlatformUserDetail>(
        ["platform", session.user.id, "user", userId],
        (current) =>
          current ? { ...current, lockedUntil: result.lockedUntil } : current
      )
      queryClient.setQueriesData<PlatformUsersPage>(
        { queryKey: ["platform", session.user.id, "users"] },
        (current) =>
          current
            ? {
                ...current,
                items: current.items.map((user) =>
                  user.userId === result.userId
                    ? { ...user, lockedUntil: result.lockedUntil }
                    : user
                ),
              }
            : current
      )
      // 密码锁属于用户；员工和登录日志读取的是同一事实，不由发起解锁的页面决定刷新范围。
      await Promise.all(
        [
          ["user", userId],
          ["users"],
          ["login-events"],
          ["employee", userId],
          ["employees"],
          ["role-employees"],
        ].map((key) =>
          queryClient.invalidateQueries({
            queryKey: ["platform", session.user.id, ...key],
          })
        )
      )
    },
  })
}
