# S4-04：请求授权与可信 TenantContext

日期：2026-09-15。

## 已确认的业务规则

用户确认现有组织和新建组织默认启用，已记录在 [ADR-0003](../adr/0003-platform-access.md)。`organization.enabled` 为非空布尔值、默认 true，沿用 Better Auth Organization 扩展字段和正式 Schema 生成链，没有第二套组织模型。

迁移 `0004_awesome_gwen_stacy.sql` 为现有数据设置默认启用状态；`0005_organization-status-grants.sql` 将 app_runtime 的组织 UPDATE 收紧到原有列，仅 platform_runtime 具有 enabled 的 UPDATE 权限。认证扩展配置 `input: false`，组织客户端不能修改启停状态。两个迁移只在临时测试数据库执行，尚未迁移开发或生产数据库。

## 请求链

1. 业务路由以 `@RequireTenant({ project: ['read'] })` 声明组织动作权限，并包含 `:organizationId` 参数。
2. TenantGuard 从路由读取目标组织，从请求读取认证 Headers，从 requestLogging 中间件读取服务端生成的 requestId。
3. TenantContextService 校验 UUID v4，IdentityService 验证当前 Session，并通过 Better Auth Organization API 按目标组织和已验证用户读取成员关系及组织状态。
4. 非成员、停用组织被拒绝；AuthorizationService 检查当前组织权限，支持动态角色。无会话返回 401，成员/状态/权限拒绝返回 403，非法 UUID 返回 400。
5. 全部检查成功后冻结 TenantContext，包含 organizationId、userId、membershipId、requestId、locale。处理器通过 `@CurrentTenant()` 获取，再传给 `runInTenant`。

上下文挂在请求的内部 Symbol 上。Header、查询参数和 Body 中自报的用户、成员、组织或 requestId 不参与上下文身份构造；active organization 不决定业务请求的目标组织。Guard 缺少权限声明或请求基础设施时作为配置错误拒绝，不进入处理器。

## 实际验证

- `pnpm lint`、`pnpm typecheck`、`pnpm test:unit` 通过；单元测试共 10 项。
- `pnpm test:api`：2 个文件、10 项通过。测试模块专用 Controller 使用正式 Guard、Service、Better Auth、PostgreSQL 和 TenantRunner，不注册到生产应用。
- HTTP 覆盖无会话、非法 UUID、非成员、组织停用、动态角色缺少动作权限、成员撤销和旧会话登出拒绝；两个组织并发请求验证响应上下文与 transaction-local 数据库组织值一致，伪造 requestId/身份参数不生效。
- 普通 runtime 修改 enabled 被数据库拒绝，平台数据库通道可停用/启用组织；停用 A 不影响 B。
- `pnpm --filter @workspace/database test:database`：2 个文件、13 项通过，包含迁移、角色权限与租户隔离测试。
- `pnpm --filter @workspace/database schema:check`、`pnpm --filter api build` 通过。

## 边界

S4-04 交付可复用授权入口，未新增 Projects 生产接口或平台启停 API；欢迎接口仍公开。测试 Controller 只存在于测试模块。平台授权与审计仍归 S8，资源 Data Scope 归 S4-06，完整 S4-07 验收仍保留独立任务。

当前 HTTP 上下文采用已确认的平台初始语言 zh-CN；完整语言协商仍归 S5。未运行浏览器 E2E 或全仓构建，未提交、推送。并发中已经开始的请求不承诺被后续撤权中断；后续请求重新读取身份、成员、状态和权限。
