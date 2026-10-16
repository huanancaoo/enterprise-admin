import { PersonalAvatar } from "./personal-avatar"
import type { ReactNode } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { ChevronsUpDownIcon, UserRoundIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { LocaleSwitcher, ThemeSwitcher } from "./workspace"
import { useAuthAction } from "../auth/use-auth-action"

function lastLoginMethodLabel(method: string, t: TFunction<"auth">) {
  if (method === "email") return t("loginMethod_email")
  if (method === "github") return t("loginMethod_github")
  throw new Error(`unknown login method: ${method}`)
}

export interface SidebarUser {
  name: string
  email: string
  avatar?: string
  lastLoginMethod?: string | null
}

export interface NavUserProps {
  user: SidebarUser
  accountMenu: (action: ReturnType<typeof useAuthAction>) => ReactNode
  onPersonalSettings: () => void
  onLocaleSelect?: () => void
}

export function NavUser({
  user,
  accountMenu,
  onPersonalSettings,
  onLocaleSelect,
}: NavUserProps) {
  const { t } = useTranslation("auth")
  const { t: settings } = useTranslation("settings")
  const { isMobile } = useSidebar()
  const accountAction = useAuthAction()
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <PersonalAvatar image={user.avatar} name={user.name} />
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
              {user.lastLoginMethod ? (
                <span className="truncate text-xs text-muted-foreground">
                  {t("lastLoginMethod", {
                    method: lastLoginMethodLabel(user.lastLoginMethod, t),
                  })}
                </span>
              ) : null}
            </div>
            <ChevronsUpDownIcon className="ms-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-fit"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
                  <PersonalAvatar image={user.avatar} name={user.name} />
                  <div className="grid flex-1 text-start text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs">{user.email}</span>
                    {user.lastLoginMethod ? (
                      <span className="truncate text-xs text-muted-foreground">
                        {t("lastLoginMethod", {
                          method: lastLoginMethodLabel(user.lastLoginMethod, t),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={onPersonalSettings}>
                <UserRoundIcon />
                {settings("personalSettings")}
              </DropdownMenuItem>
              <ThemeSwitcher variant="submenu" />
              <LocaleSwitcher
                variant="submenu"
                onLocaleSelect={onLocaleSelect}
              />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {accountMenu(accountAction)}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
