import {
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access"

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

// 认证配置和只读角色目录共用同一声明，页面不能另维护一份权限事实。
export const builtInOrganizationRolePermissions = {
  owner: {
    ...ownerAc.statements,
    member: [...ownerAc.statements.member, "read"],
    project: [...projectActions],
    tenantSettings: ["read", "update"],
    audit: ["read"],
  },
  admin: {
    ...adminAc.statements,
    member: [...adminAc.statements.member, "read"],
    project: [...projectActions],
    tenantSettings: ["read", "update"],
    audit: ["read"],
  },
  member: {
    ...memberAc.statements,
    member: ["read"],
    project: ["read"],
  },
} as const

// 只声明固定动作；角色及成员的实际授予仍由 Better Auth 管理。
export const auditActions = ["read"] as const
export type AuditAction = (typeof auditActions)[number]

export const permissionStatements = {
  member: ["read"],
  project: projectActions,
  tenantSettings: tenantSettingsActions,
  audit: auditActions,
} as const
export type PermissionRequest = {
  member?: (typeof permissionStatements.member)[number][]
  project?: ProjectAction[]
  tenantSettings?: (typeof tenantSettingsActions)[number][]
  audit?: AuditAction[]
}
