export { useTheme } from "@workspace/ui/components/theme-provider"
export { AppSidebar } from "./components/app-sidebar"
export type { AppSidebarProps } from "./components/app-sidebar"
export { ConfirmDangerAction } from "./components/confirm-danger-action"
export type { ConfirmDangerActionProps } from "./components/confirm-danger-action"
export { NavMain } from "./components/nav-main"
export type { NavMainItem, NavMainProps } from "./components/nav-main"
export { NavUser } from "./components/nav-user"
export type { NavUserProps, SidebarUser } from "./components/nav-user"
export {
  AppShell,
  EmptyState,
  ErrorState,
  FilterBar,
  FormDialog,
  LoadingState,
  NotFoundContent,
  NotFoundState,
  PageHeader,
  PermissionDeniedState,
  ResourceList,
  RouterErrorComponent,
} from "./components/page"
export type { AppShellProps } from "./components/page"
export { Pagination } from "./components/pagination"
export { TeamSwitcher } from "./components/team-switcher"
export type { SidebarTeam, TeamSwitcherProps } from "./components/team-switcher"
export {
  AdminDirectionProvider,
  LocaleSwitcher,
  PermissionGate,
  TenantSwitcher,
  ThemeProvider,
  ThemeSwitcher,
} from "./components/workspace"
export type {
  LocaleSwitcherProps,
  Theme,
  ThemeSwitcherProps,
} from "./components/workspace"
export { useDocumentTitle } from "./hooks/use-document-title"

export { PersonalAvatar } from "./components/personal-avatar"
export { PersonalAvatarSettings } from "./components/personal-avatar-settings"

export { PersonalSecuritySettings } from "./components/personal-security-settings"

export { IDEMPOTENCY_KEY_HEADER, nextIdempotencyAttempt } from "./idempotency"
export type { IdempotencyAttempt } from "./idempotency"
