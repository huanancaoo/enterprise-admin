import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { LogOutIcon, PlusIcon, UsersIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useWorkspaceAuthClient } from "./auth-client-context"
import { useAuthAction } from "./use-auth-action"

type DeviceSessionMenuProps = {
  onAddAccount: () => void
  onSessionChanged?: () => void
  action: ReturnType<typeof useAuthAction>
}

function reloadWorkspace() {
  // 账号变更后从入口重建路由、权限和组织状态，不让旧页面继续持有前一个账号的事实。
  window.location.assign("/")
}

function useDeviceSessions() {
  const client = useWorkspaceAuthClient()
  return useQuery({
    queryKey: ["auth", "device-sessions"],
    queryFn: async () => {
      const result = await client.multiSession.listDeviceSessions()
      if (result.error) throw new Error(result.error.message)
      return result.data
    },
    retry: false,
  })
}

export function DeviceSessionMenu(props: DeviceSessionMenuProps) {
  const sessions = useDeviceSessions()
  return <DeviceSessionMenuContent {...props} sessions={sessions} />
}

function DeviceSessionMenuContent({
  onAddAccount,
  onSessionChanged = reloadWorkspace,
  action,
  sessions,
}: DeviceSessionMenuProps & {
  sessions: ReturnType<typeof useDeviceSessions>
}) {
  const client = useWorkspaceAuthClient()
  const { t } = useTranslation(["auth", "common"])
  const current = client.useSession().data

  async function changeSession(operation: Parameters<typeof action.run>[0]) {
    if (await action.run(operation)) onSessionChanged()
  }

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t("auth:accountsOnDevice")}</DropdownMenuLabel>
        {sessions.isPending && (
          <DropdownMenuItem disabled>
            <span role="status">{t("common:loading")}</span>
          </DropdownMenuItem>
        )}
        {sessions.isError && (
          <>
            <DropdownMenuItem disabled className="max-w-72 text-destructive">
              <span role="alert">{t("auth:accountListFailed")}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              closeOnClick={false}
              onClick={() => void sessions.refetch()}
            >
              {t("common:retry")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuRadioGroup value={current?.user.id ?? ""}>
          {sessions.data?.map(({ session, user }) => (
            <DropdownMenuRadioItem
              key={user.id}
              value={user.id}
              disabled={action.pending}
              closeOnClick={false}
              onClick={() => {
                if (user.id === current?.user.id) return
                void changeSession(() =>
                  client.multiSession.setActive({ sessionToken: session.token })
                )
              }}
            >
              <div className="grid min-w-0 text-start">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuItem disabled={action.pending} onClick={onAddAccount}>
          <PlusIcon />
          {t("auth:addAccount")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {current && (
          <DropdownMenuItem
            disabled={action.pending}
            closeOnClick={false}
            onClick={() =>
              void changeSession(() =>
                client.multiSession.revoke({
                  sessionToken: current.session.token,
                })
              )
            }
          >
            <LogOutIcon />
            {t("auth:signOut")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          disabled={action.pending}
          closeOnClick={false}
          onClick={() => void changeSession(() => client.signOut())}
        >
          <LogOutIcon />
          {t("auth:signOutAllAccounts")}
        </DropdownMenuItem>
      </DropdownMenuGroup>
      {action.error && (
        <DropdownMenuGroup>
          <DropdownMenuItem disabled className="max-w-72 text-destructive">
            <span role="alert">{action.error}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      )}
    </>
  )
}

export function DeviceAccountSwitcher({
  disabled,
  ...props
}: DeviceSessionMenuProps & { disabled?: boolean }) {
  const client = useWorkspaceAuthClient()
  const current = client.useSession().data
  const sessions = useDeviceSessions()
  const { t } = useTranslation("auth")

  // 登录表单已能添加账号，匿名空列表无需菜单；查询失败仍需允许重试。
  // 重试不能卸载已打开的菜单，因此只隐藏尚未完成首次查询的 pending 状态。
  if (
    !current &&
    ((sessions.isPending && !sessions.isFetched) ||
      (sessions.isSuccess && sessions.data?.length === 0))
  ) {
    return null
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open && sessions.isSuccess) void sessions.refetch()
      }}
    >
      <DropdownMenuTrigger
        disabled={disabled || props.action.pending}
        render={<Button variant="outline" />}
      >
        <UsersIcon />
        {t("switchAccount")}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="center">
        <DeviceSessionMenuContent {...props} sessions={sessions} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
