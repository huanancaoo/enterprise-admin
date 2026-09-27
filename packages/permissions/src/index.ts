export const projectActions = [
  "read",
  "create",
  "update",
  "delete",
  "export",
  "translate",
] as const
export const delegableRolePermissions = {
  project: projectActions,
  member: ["read", "update", "delete"],
  invitation: ["create", "cancel"],
  tenantSettings: ["read"],
  audit: ["read"],
} as const

export const tenantSettingsActions = ["read", "update"] as const

export type ProjectAction = (typeof projectActions)[number]
export type ProjectPermission = `project:${ProjectAction}`
export const builtInOrganizationRoleKeys = ["owner", "admin", "member"] as const

// 只声明固定动作；角色及成员的实际授予仍由 Better Auth 管理。
export const permissionStatements = {
  member: ["read"],
  project: projectActions,
  tenantSettings: tenantSettingsActions,
} as const
export type PermissionRequest = {
  member?: (typeof permissionStatements.member)[number][]
  project?: ProjectAction[]
  tenantSettings?: (typeof tenantSettingsActions)[number][]
}
