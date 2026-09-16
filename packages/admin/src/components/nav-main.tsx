import type { ReactElement, ReactNode } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@workspace/ui/components/sidebar"
import { ChevronRightIcon } from "lucide-react"

export interface NavMainItem {
  title: string
  icon: ReactNode
  isActive?: boolean
  disabled?: boolean
  render?: ReactElement
  items?: Array<{ title: string; render: ReactElement; isActive?: boolean }>
}

export interface NavMainProps {
  label: string
  items: NavMainItem[]
}

export function NavMain({ label, items }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <nav aria-label={label}>
        <SidebarMenu>
          {items.map((item) =>
            item.items?.length ? (
              <Collapsible
                key={item.title}
                defaultOpen={item.isActive}
                className="group/collapsible"
                render={<SidebarMenuItem />}
              >
                <CollapsibleTrigger
                  render={
                    <SidebarMenuButton
                      tooltip={item.title}
                      isActive={item.isActive}
                    />
                  }
                >
                  {item.icon}
                  <span>{item.title}</span>
                  <ChevronRightIcon className="ms-auto transition-transform duration-200 group-data-open/collapsible:rotate-90 rtl:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((child) => (
                      <SidebarMenuSubItem key={child.title}>
                        <SidebarMenuSubButton
                          render={child.render}
                          isActive={child.isActive}
                        >
                          <span>{child.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  render={item.render}
                  tooltip={item.title}
                  isActive={item.isActive}
                  disabled={item.disabled}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          )}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  )
}
