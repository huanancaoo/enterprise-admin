import { useState, type ReactElement, type ReactNode } from "react"
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
  SidebarMenuAction,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@workspace/ui/components/sidebar"
import { useTranslation } from "react-i18next"
import { ChevronRightIcon } from "lucide-react"

export interface NavMainItem {
  title: string
  icon?: ReactNode
  isActive?: boolean
  disabled?: boolean
  render?: ReactElement
  items?: NavMainItem[]
}

export interface NavMainProps {
  label: string
  items: NavMainItem[]
}

function NavItem({
  item,
  nested = false,
}: {
  item: NavMainItem
  nested?: boolean
}) {
  const { t } = useTranslation("common")
  const active = item.isActive || item.items?.some(isActive)
  const [open, setOpen] = useState(Boolean(active))
  const content = (
    <>
      {item.icon}
      <span>{item.title}</span>
    </>
  )
  const chevron = (
    <ChevronRightIcon
      className={`ms-auto size-4 shrink-0 transition-transform duration-200 ease-in-out motion-reduce:transition-none ${open ? "rotate-90" : "rtl:rotate-180"}`}
      aria-hidden="true"
    />
  )
  const button = nested ? (
    <SidebarMenuSubButton
      render={item.render}
      isActive={item.isActive}
      className={item.items?.length ? "pe-8" : undefined}
    >
      {content}
    </SidebarMenuSubButton>
  ) : (
    <SidebarMenuButton
      render={item.render}
      className={item.items?.length ? "pe-8" : undefined}
      tooltip={item.title}
      isActive={item.isActive}
      disabled={item.disabled}
    >
      {content}
    </SidebarMenuButton>
  )
  const Item = nested ? SidebarMenuSubItem : SidebarMenuItem
  if (!item.items?.length) return <Item>{button}</Item>
  return (
    <Collapsible open={open} onOpenChange={setOpen} render={<Item />}>
      {item.render ? (
        <>
          {button}
          <CollapsibleTrigger
            render={
              <SidebarMenuAction
                type="button"
                aria-label={t("toggleSubmenu", { title: item.title })}
              />
            }
            disabled={item.disabled}
          >
            {chevron}
          </CollapsibleTrigger>
        </>
      ) : (
        <CollapsibleTrigger
          render={
            nested ? (
              <SidebarMenuSubButton render={<button type="button" />} />
            ) : (
              <SidebarMenuButton tooltip={item.title} />
            )
          }
          disabled={item.disabled}
        >
          {content}
          {chevron}
        </CollapsibleTrigger>
      )}
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden opacity-100 transition-[height,opacity] duration-200 ease-in-out data-[ending-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:h-0 data-[starting-style]:opacity-0 motion-reduce:transition-none">
        <SidebarMenuSub>
          {item.items.map((child) => (
            <NavItem key={navigationKey(child)} item={child} nested />
          ))}
        </SidebarMenuSub>
      </CollapsibleContent>
    </Collapsible>
  )
}

function isActive(item: NavMainItem): boolean {
  return Boolean(item.isActive || item.items?.some(isActive))
}

// 活跃页面变化时重建所在分支，展开新页面祖先；同一页面的手动收起保持有效。
function navigationKey(item: NavMainItem): string {
  return `${item.title}:${item.isActive ? "active" : ""}:${item.items?.filter(isActive).map(navigationKey).join("/") ?? ""}`
}

export function NavMain({ label, items }: NavMainProps) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <nav aria-label={label}>
        <SidebarMenu>
          {items.map((item) => (
            <NavItem key={navigationKey(item)} item={item} />
          ))}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  )
}
