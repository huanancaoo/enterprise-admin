import type { ComponentProps } from "react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@workspace/ui/components/sidebar"
import { NavMain, type NavMainProps } from "./nav-main"
import { NavUser, type NavUserProps } from "./nav-user"
import { TeamSwitcher, type TeamSwitcherProps } from "./team-switcher"

export interface AppSidebarProps extends ComponentProps<typeof Sidebar> {
  teamSwitcher: TeamSwitcherProps
  navigation: NavMainProps
  user: NavUserProps
}

export function AppSidebar({
  teamSwitcher,
  navigation,
  user,
  ...props
}: AppSidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher {...teamSwitcher} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain {...navigation} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser {...user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
