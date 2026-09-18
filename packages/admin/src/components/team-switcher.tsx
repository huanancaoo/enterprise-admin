"use client"

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
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react"

export interface SidebarTeam {
  id: string
  name: string
  description?: string
  logo?: ReactNode
}

export interface TeamSwitcherProps {
  teams: readonly SidebarTeam[]
  value: string | null
  label: string
  disabled?: boolean
  createLabel?: string
  onSelect: (teamId: string) => void
  onCreate?: () => void
}

export function TeamSwitcher({
  teams,
  value,
  label,
  disabled = false,
  createLabel,
  onSelect,
  onCreate,
}: TeamSwitcherProps) {
  const { isMobile } = useSidebar()
  const activeTeam = teams.find((team) => team.id === value)
  const triggerName = activeTeam?.name ?? label
  const triggerLogo = activeTeam?.logo ?? triggerName.slice(0, 1)

  // 空列表不走 Tooltip：TooltipTrigger 不会把 disabled 落到原生按钮上。
  if (teams.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled>
            <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
              {label.slice(0, 1)}
            </span>
            <span className="truncate font-medium">{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={triggerName}
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
              {triggerLogo}
            </span>
            <span className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{triggerName}</span>
              {activeTeam?.description && (
                <span className="truncate text-xs">
                  {activeTeam.description}
                </span>
              )}
            </span>
            {!disabled && <ChevronsUpDownIcon className="ms-auto" />}
          </DropdownMenuTrigger>
          {/* 忙碌时只禁用项，不能卸掉 Popup：否则关闭动画被打断，aria-hidden 焦点守卫会留在树上。 */}
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {label}
              </DropdownMenuLabel>
              {teams.map((team) => (
                <DropdownMenuItem
                  key={team.id}
                  disabled={disabled}
                  onClick={() => onSelect(team.id)}
                  className="gap-2 p-2"
                >
                  <span className="flex size-6 items-center justify-center rounded-md border text-xs font-medium">
                    {team.logo ?? team.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{team.name}</span>
                  {team.id === activeTeam?.id && (
                    <CheckIcon className="size-4" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            {onCreate && createLabel && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={disabled}
                  onClick={onCreate}
                  className="gap-2 p-2"
                >
                  <span className="flex size-6 items-center justify-center rounded-md border">
                    <PlusIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{createLabel}</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
