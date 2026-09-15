# S4-03：身份与授权适配层

日期：2026-09-15。

## 实施范围

- `IdentityService.getIdentity(headers)` 读取当前会话，只返回 `userId`、`sessionId` 或 `null`；`requireIdentity` 对未登录抛出 NestJS 401。业务侧不接收 Better Auth 的 Session/User 实体或会话 token。
- `AuthorizationService.requirePermission(headers, organizationId, permissions)` 通过 Better Auth Organization API 检查目标组织的成员关系和权限，支持现有静态及动态角色。空组织 ID 被拒绝，避免隐式使用 active organization。
- 非成员和权限不足转换为 NestJS 403；无会话转换为 401；数据库等非授权错误继续传播，不将基础设施故障伪装为权限拒绝。
- 两个服务在正式 `createApplication` 中注册并导出，复用唯一 AuthRuntime，随应用关闭其 Pool。调用方传递当前请求 Headers；目标组织与所需权限由业务入口确定，不能采用客户端自报的角色或权限作为授权依据。
- 未新增 Organization、Member、Invitation、Role 模型或数据表。前端认证仍使用 Better Auth Client，认证 HTTP 路由仍由官方 Node Handler 承载。

接口依据为当前安装的 Better Auth 1.7.5 实现及[官方 Organization API](https://better-auth.com/docs/plugins/organization)。权限目录提取仍属于 S4-05；此处的 `PermissionRequest` 只是调用参数，不定义另一套角色或权限事实。

## 实际验证

- `pnpm lint`、`pnpm typecheck` 通过。
- `pnpm test:unit`：工程边界 6 项、API 单元 4 项通过。新增单元测试覆盖空组织 ID、拒绝异常转换、基础设施错误传播。
- `pnpm test:api`：2 个文件、9 项通过。使用临时 PostgreSQL、正式迁移、app_runtime、Nest Express 和 Better Auth Client；验证最小身份投影、无会话拒绝、跨组织非成员拒绝、动态角色只读/创建权限及角色修改即时生效、登出后旧 Cookie 拒绝。
- `pnpm --filter api build` 通过。
- 首次 HTTP/数据库测试受沙箱端口与 Docker 访问限制；获得所需执行权限后重跑通过。

## 验收边界

本次完成 S4-03 的适配层。尚未建立业务 Guard、可信 TenantContext、组织状态校验或资源 Data Scope；这些仍按 S4-04 至 S4-07 实施。现有欢迎接口保持公开，不能将服务测试视为完整受保护业务 HTTP 流程验收。未修改前端流程，未运行浏览器 E2E 或全仓生产构建；未提交、推送。
