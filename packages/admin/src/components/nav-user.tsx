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
import { LocaleSwitcher, ThemeSwitcher } from "./workspace"
import { useAuthAction } from "../auth/use-auth-action"

export interface SidebarUser {
  name: string
  email: string
  avatar?: string
}

export interface NavUserProps {
  user: SidebarUser
  accountMenu: (action: ReturnType<typeof useAuthAction>) => ReactNode
  signOutMenu: (action: ReturnType<typeof useAuthAction>) => ReactNode
  onPersonalSettings: () => void
  onLocaleSelect?: () => void
}

export function NavUser({
  user,
  accountMenu,
  signOutMenu,
  onPersonalSettings,
  onLocaleSelect,
}: NavUserProps) {
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
            <span aria-hidden="true">
              <PersonalAvatar image={user.avatar} name={user.name} />
            </span>
            <div className="grid min-w-0 flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ms-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-72 max-w-[calc(100vw-2rem)] rounded-xl shadow-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-3 px-3 py-4 text-start">
                  <span aria-hidden="true">
                    <PersonalAvatar
                      image={user.avatar}
                      name={user.name}
                      className="size-10"
                    />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1 text-start text-base leading-tight">
                    <span className="truncate font-medium text-foreground">
                      {user.name}
                    </span>
                    <span
                      className="truncate text-sm text-muted-foreground"
                      title={user.email}
                    >
                      {user.email}
                    </span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="mx-2 my-3" />
            <DropdownMenuGroup>{accountMenu(accountAction)}</DropdownMenuGroup>
            <DropdownMenuGroup className="*:min-h-12 *:text-base [&_svg]:size-5">
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
            <DropdownMenuSeparator className="mx-2 my-3" />
            {signOutMenu(accountAction)}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
