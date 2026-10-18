// 目录只注册可执行动作；菜单可见性不能替代服务端动作授权。
export const platformPermissionStatements = {
  authorization: ["manage"],
  organization: ["read", "update", "export"],
  user: [
    "read",
    "create",
    "update",
    "suspend",
    "resetPassword",
    "readSensitive",
    "unlock",
    "export",
  ],
  audit: ["read", "export"],
  settings: ["read", "update"],
  login: ["read", "export"],
  session: ["read", "revoke", "export"],
  employee: ["read", "create", "update", "delete", "export"],
  role: ["read", "create", "update", "delete", "export"],
  menu: ["read", "create", "update", "delete", "export"],
  department: ["read", "create", "update", "delete", "export"],
  post: ["read", "create", "update", "delete", "export"],
  dictionary: ["read", "create", "update", "delete", "export", "refresh"],
  parameter: ["read", "create", "update", "delete", "export", "refresh"],
  announcement: ["read", "create", "update", "delete", "publish", "readers"],
  task: ["read", "download"],
  monitor: ["read"],
  schedule: ["read", "manage", "run"],
} as const

type Statements = typeof platformPermissionStatements
export type PlatformPermission = {
  [R in keyof Statements]: `platform.${R}:${Statements[R][number]}`
}[keyof Statements]

export const platformPermissions = Object.entries(
  platformPermissionStatements
).flatMap(([resource, actions]) =>
  actions.map(
    (action) => `platform.${resource}:${action}` as PlatformPermission
  )
)
export const delegablePlatformPermissions = platformPermissions.filter(
  (permission) => permission !== "platform.authorization:manage"
)
export const builtInPlatformRoleKeys = [
  "platform_admin",
  "platform_auditor",
] as const
