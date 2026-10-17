import { useCallback, useState, useSyncExternalStore } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { unlockPlatformUserPasswordLogin } from "@workspace/api-client"
import { PasswordLoginUnlockResultSchema } from "@workspace/contracts/identity-management"
import type {
  PlatformUserDetail,
  PlatformUsersPage,
} from "@workspace/contracts/platform"
import { useAuthenticatedSession } from "@workspace/admin/auth"
import { createFormatter } from "@workspace/i18n"
import { useUiLocale } from "@workspace/i18n/react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { usePlatformAccessFailure } from "../../lib/use-platform-access-failure"

function useActivePasswordLock(lockedUntil: string | null) {
  const snapshot = useCallback(
    () => lockedUntil !== null && Date.parse(lockedUntil) > Date.now(),
    [lockedUntil]
  )
  const subscribe = useCallback(
    (notify: () => void) => {
      if (lockedUntil === null) return () => {}
      const remaining = Date.parse(lockedUntil) - Date.now()
      if (remaining <= 0) return () => {}
      // 到期只更新展示；保存的锁定记录由服务端登录流程处理。
      const timeout = setTimeout(notify, remaining + 1)
      return () => clearTimeout(timeout)
    },
    [lockedUntil]
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function PlatformPasswordLoginLock({
  userId,
  name,
  lockedUntil,
  canUnlock,
  showExpiry = false,
}: {
  userId: string
  name: string
  lockedUntil: string | null
  canUnlock: boolean
  showExpiry?: boolean
}) {
  const { t } = useTranslation(["identity", "common"])
  const session = useAuthenticatedSession()!
  const queryClient = useQueryClient()
  const format = createFormatter(useUiLocale())
  const active = useActivePasswordLock(lockedUntil)
  const [open, setOpen] = useState(false)
  const rejectAccess = usePlatformAccessFailure()
  const unlock = useMutation({
    mutationFn: async () =>
      PasswordLoginUnlockResultSchema.parse(
        (await unlockPlatformUserPasswordLogin(userId)).data
      ),
    onSuccess: async (result) => {
      setOpen(false)
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
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["platform", session.user.id, "user", userId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["platform", session.user.id, "users"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["platform", session.user.id, "login-events"],
        }),
      ])
    },
    onError: (error) => void rejectAccess(error),
  })
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={active ? "destructive" : "outline"}>
          {active
            ? t("identity:passwordLoginLocked")
            : lockedUntil === null
              ? t("identity:passwordLoginUnlocked")
              : t("identity:passwordLoginLockExpired")}
        </Badge>
        {active && canUnlock && (
          <Button
            size="sm"
            variant="outline"
            disabled={unlock.isPending}
            onClick={() => {
              unlock.reset()
              setOpen(true)
            }}
          >
            {t("identity:unlockPasswordLogin")}
          </Button>
        )}
      </div>
      {showExpiry && lockedUntil !== null && (
        <p className="text-xs font-normal text-muted-foreground">
          {t("identity:passwordLoginLockUntil", {
            date: format.dateTime(new Date(lockedUntil), "UTC", {
              dateStyle: "medium",
              timeStyle: "medium",
            }),
          })}
        </p>
      )}
      {unlock.isSuccess && (
        <p role="status" className="text-xs font-normal text-muted-foreground">
          {t("identity:passwordLoginUnlockSucceeded")}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => !unlock.isPending && setOpen(next)}
      >
        <DialogContent
          showCloseButton={!unlock.isPending}
          aria-busy={unlock.isPending}
        >
          <DialogHeader>
            <DialogTitle>{t("identity:unlockPasswordLogin")}</DialogTitle>
            <DialogDescription>
              {t("identity:passwordLoginUnlockDescription", { name })}
            </DialogDescription>
          </DialogHeader>
          {!active && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("identity:passwordLoginLockExpired")}
            </p>
          )}
          {unlock.isError && (
            <p role="alert" className="text-sm text-destructive">
              {unlock.error instanceof Error
                ? unlock.error.message
                : t("common:operationFailed")}
            </p>
          )}
          <DialogFooter>
            <Button
              disabled={unlock.isPending}
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              disabled={!active || !canUnlock || unlock.isPending}
              onClick={() => unlock.mutate()}
            >
              {unlock.isPending
                ? t("common:submitting")
                : t("identity:confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
