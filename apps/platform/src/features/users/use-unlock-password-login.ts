import { useMutation } from "@tanstack/react-query"
import { unlockPlatformUserPasswordLogin } from "@workspace/api-client"
import { PasswordLoginUnlockResultSchema } from "@workspace/contracts/identity-management"
import { usePlatformUserChanges } from "./user-queries"

export function useUnlockPasswordLogin(userId: string) {
  const changes = usePlatformUserChanges()
  return useMutation({
    mutationFn: async () =>
      PasswordLoginUnlockResultSchema.parse(
        (await unlockPlatformUserPasswordLogin(userId)).data
      ),
    onSuccess: changes.unlocked,
  })
}
