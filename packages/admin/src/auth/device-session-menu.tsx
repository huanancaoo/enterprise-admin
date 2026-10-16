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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { PersonalAvatar } from "../components/personal-avatar"
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

async function changeSession(
  action: DeviceSessionMenuProps["action"],
  operation: Parameters<DeviceSessionMenuProps["action"]["run"]>[0],
  onSessionChanged = reloadWorkspace
) {
  if (await action.run(operation)) onSessionChanged()
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
  const { t } = useTranslation("auth")
  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        // 快速重开时查询仍可能挂载；每次进入账号列表都重新读取其他页面新增的会话。
        if (open && sessions.isSuccess) void sessions.refetch()
      }}
    >
      <DropdownMenuSubTrigger
        disabled={props.action.pending}
        className="min-h-16 gap-3 text-base"
      >
        <UsersIcon className="size-5" />
        <div className="grid min-w-0 flex-1 gap-0.5 text-start">
          <span className="font-medium">{t("switchAccount")}</span>
          {sessions.data && (
            <span className="text-xs text-foreground/70">
              {t("accountCount", { total: sessions.data.length })}
            </span>
          )}
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl shadow-lg"
        sideOffset={8}
        alignOffset={-80}
      >
        <DeviceSessionList {...props} sessions={sessions} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

function DeviceSessionList({
  onAddAccount,
  onSessionChanged,
  action,
  sessions,
}: DeviceSessionMenuProps & {
  sessions: ReturnType<typeof useDeviceSessions>
}) {
  const client = useWorkspaceAuthClient()
  const { t } = useTranslation(["auth", "common"])
  const current = client.useSession().data

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="px-3 py-3 text-sm">
        {t("auth:accountsOnDevice")}
      </DropdownMenuLabel>
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
            className="min-h-18 gap-3 py-3 text-base aria-checked:bg-primary/5 [&_[data-slot=dropdown-menu-radio-item-indicator]]:text-primary"
            disabled={action.pending}
            closeOnClick={false}
            onClick={() => {
              if (user.id === current?.user.id) return
              void changeSession(
                action,
                () =>
                  client.multiSession.setActive({
                    sessionToken: session.token,
                  }),
                onSessionChanged
              )
            }}
          >
            <span aria-hidden="true" className="shrink-0">
              <PersonalAvatar name={user.name} className="size-10" />
            </span>
            <div className="grid min-w-0 flex-1 gap-0.5 text-start">
              <span className="truncate font-medium">{user.name}</span>
              <span
                className="truncate text-sm text-muted-foreground"
                title={user.email}
              >
                {user.email}
              </span>
            </div>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className="mx-2 my-1.5" />
      <DropdownMenuItem
        className="min-h-12 text-base"
        disabled={action.pending}
        onClick={onAddAccount}
      >
        <PlusIcon className="size-5" />
        {t("auth:addAccount")}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

export function DeviceSessionActions({
  onSessionChanged,
  action,
}: Pick<DeviceSessionMenuProps, "onSessionChanged" | "action">) {
  const client = useWorkspaceAuthClient()
  const { t } = useTranslation("auth")
  const current = client.useSession().data
  return (
    <DropdownMenuGroup>
      {current && (
        <DropdownMenuItem
          className="min-h-12 text-base"
          disabled={action.pending}
          closeOnClick={false}
          onClick={() =>
            void changeSession(
              action,
              () =>
                client.multiSession.revoke({
                  sessionToken: current.session.token,
                }),
              onSessionChanged
            )
          }
        >
          <LogOutIcon className="size-5" />
          {t("signOutCurrentAccount")}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className="min-h-12 text-base"
        variant="destructive"
        disabled={action.pending}
        closeOnClick={false}
        onClick={() =>
          void changeSession(action, () => client.signOut(), onSessionChanged)
        }
      >
        <LogOutIcon className="size-5" />
        {t("signOutAllAccounts")}
      </DropdownMenuItem>
      {action.error && (
        <DropdownMenuItem disabled className="max-w-72 text-destructive">
          <span role="alert">{action.error}</span>
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
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
      <DropdownMenuContent
        className="w-72 max-w-[calc(100vw-2rem)] rounded-xl shadow-lg"
        align="center"
      >
        <DeviceSessionList {...props} sessions={sessions} />
        <DropdownMenuSeparator />
        <DeviceSessionActions
          action={props.action}
          onSessionChanged={props.onSessionChanged}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
