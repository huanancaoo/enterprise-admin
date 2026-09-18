# @workspace/permissions

S4 的固定项目权限目录：`project:read/create/update/delete/export/translate`。

- `projectActions` / `permissionStatements` 供认证配置定义动作集合。
- `ProjectAction` / `ProjectPermission` / `PermissionRequest` 供调用方约束动作类型。
- 组织角色、动态角色及成员授予仍由 Better Auth 管理；本包不存储角色或成员关系。

首版权限覆盖整个组织，不增加负责人或归档状态限制。`export` 仅声明权限，不提供导出功能。客户端引用目录不构成授权证明；API 必须执行 `RequireTenant`，资源修改由 Projects module 在 TenantTx 中锁定资源并同时记录审计。
