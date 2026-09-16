"use client"

import type { ReactNode } from "react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@workspace/ui/components/sidebar"
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react"

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
  onSelect: (teamId: string) => void
}

export function TeamSwitcher({
  teams,
  value,
  label,
  disabled = false,
  onSelect,
}: TeamSwitcherProps) {
  const { isMobile } = useSidebar()
  const activeTeam = teams.find((team) => team.id === value)

  if (!activeTeam) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip={label} disabled>
            <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
              {label.slice(0, 1)}
            </span>
            <span className="truncate font-medium">{label}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  const activeLogo = activeTeam.logo ?? activeTeam.name.slice(0, 1)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled}
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={activeTeam.name}
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground">
              {activeLogo}
            </span>
            <span className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">{activeTeam.name}</span>
              {activeTeam.description && (
                <span className="truncate text-xs">
                  {activeTeam.description}
                </span>
              )}
            </span>
            {!disabled && <ChevronsUpDownIcon className="ms-auto" />}
          </DropdownMenuTrigger>
          {!disabled && (
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
                    onClick={() => onSelect(team.id)}
                    className="gap-2 p-2"
                  >
                    <span className="flex size-6 items-center justify-center rounded-md border text-xs font-medium">
                      {team.logo ?? team.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{team.name}</span>
                    {team.id === activeTeam.id && (
                      <CheckIcon className="size-4" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
