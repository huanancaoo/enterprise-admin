import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
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
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "@workspace/i18n"
import { LocaleSwitcher, ThemeSwitcher } from "./workspace"

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
  signingOut: boolean
  error?: string
  onSignOut: () => void
}

export function NavUser({ user, signingOut, error, onSignOut }: NavUserProps) {
  const { t } = useTranslation("auth")
  const { isMobile } = useSidebar()
  const fallback = user.name.trim().slice(0, 2).toUpperCase() || "U"
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />
            }
          >
            <Avatar>
              {user.avatar && <AvatarImage src={user.avatar} alt={user.name} />}
              <AvatarFallback className="text-foreground">
                {fallback}
              </AvatarFallback>
            </Avatar>
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
                  <Avatar>
                    {user.avatar && (
                      <AvatarImage src={user.avatar} alt={user.name} />
                    )}
                    <AvatarFallback className="text-foreground">
                      {fallback}
                    </AvatarFallback>
                  </Avatar>
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
              <ThemeSwitcher variant="submenu" />
              <LocaleSwitcher variant="submenu" />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={signingOut} onClick={onSignOut}>
                <LogOutIcon />
                {signingOut ? t("signingOut") : t("signOut")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {error && (
              <p
                role="alert"
                className="max-w-64 px-2 py-1 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
