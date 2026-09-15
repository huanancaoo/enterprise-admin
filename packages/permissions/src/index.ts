export const projectActions = [
  "read",
  "create",
  "update",
  "delete",
  "export",
  "translate",
] as const

export type ProjectAction = (typeof projectActions)[number]
export type ProjectPermission = `project:${ProjectAction}`

// 只声明固定动作；角色及成员的实际授予仍由 Better Auth 管理。
export const permissionStatements = { project: projectActions } as const
export type PermissionRequest = { project: ProjectAction[] }
