# S5：API 契约、语言协商与生成客户端

日期：2026-09-15。依据 [原架构](multi-tenant-foundation.md)、[S5 计划](implementation-plan.md#s5建立-api-契约错误与本地化规则生成客户端) 和 [Projects 全链路计划](implementation-plan.md#s7完成-projects-全链路每个操作纵向交付)。

## 当前交付与待确认项

S5 的第一条真实链路已实现：生成 SDK / Query options → Projects List HTTP → Session / Membership / 权限 → TenantTx → PostgreSQL。S5-01 的 Update 字段范围尚待用户确认：只更新 status，还是同时更新基础语言的名称和描述。在确认前不创建 Update Schema，也不宣布整个 S5 已完成。

- `packages/contracts` 定义语言无关的 ListQuery、Create、ProjectResponse、ProjectPage 和 ApiError。禁止请求体覆盖组织归属。翻译文案与运行时位于 `packages/i18n`。
- Nest 原生 Standard Schema 校验与 Swagger 使用同一份 Zod Schema。正式列表路径为 `/api/v1/organizations/:organizationId/projects`，operationId 为 `listProjects`。OpenAPI 导出复用正式应用注册入口，不监听端口或查询数据库。
- Orval 生成 API SDK 和 TanStack Query hooks。公共 `useProjectsList` 与 `getProjectsListOptions` 要求明确的 UI locale，以同一份值构造 Header 和 Query Key；详情工厂也包含组织、资源 ID 与 locale，详情接口尚未交付。不增加 userScope。
- 列表按整条译文选择显示内容，保留已选译文的 null 描述；名称按显示值进行字面量子串匹配。分页和总数来自同一 SQL，时间相同按 id 升序，越界页保留真实总数。基础译文缺失返回内部错误，不悄悄隐藏项目。
- 业务错误返回 code/message/requestId/locale，并设置 Content-Language。校验错误、无身份、无权限、资源不存在和内部错误分别使用稳定 code；内部异常详情不进入响应。Better Auth 继续使用自己的错误协议。

## 语言与配置边界

语言优先级保持 Accept-Language → user.preferredLocale → organization.defaultLocale → zh-CN。Header 对明确支持的 zh-CN/en-US/ar 大小写不敏感匹配，按 q 降序、同权原顺序选择；q=0、通配符、未支持语言和非法项不参与 Header 选择。不把其他区域语言隐式映射为支持语言。

请求进入时先读取 Header。认证成功后纳入用户偏好；成员关系与组织读取成功后纳入组织默认值。非成员不能借语言协商读取目标组织资料。每个响应使用固定 translator，不修改共享服务器语言。

新增迁移 0006/0007：用户 preferred_locale 可空；组织 default_locale 初始为 zh-CN；数据库约束限制支持值，组织默认语言列获得必要的 runtime UPDATE 权限，enabled 仍不能由 app_runtime 修改。组织 defaultLocale 不开放为 Better Auth 客户端输入，设置流程留在 S8。

业务响应采用 `Cache-Control: private, no-store`，不使用共享缓存。Content-Language 是协商语言；每个项目实际内容语言由 resolvedLocale 表达。

## 验证

- `pnpm typecheck`：通过，包含生成 SDK 与前端类型检查。
- `pnpm lint`：通过，包含包边界。
- `pnpm test:unit`：19 项通过，包含新增契约、Locale、Query Key 与客户端测试。
- `pnpm test:api`：统一执行 Nest HTTP 回归与生成 SDK 集成测试，覆盖真实会话、组织、权限撤销及 Projects 列表。
- `pnpm db:check && pnpm test:database`：认证 Schema 无漂移，13 项数据库/隔离测试通过，临时数据库运行全部迁移。
- Projects SDK 集成测试位于 `tests/api/projects.test.mjs`，通过 `pnpm test:api` 执行；使用单独临时 PostgreSQL 验证请求、显示名称筛选、分页、语言、错误、隔离及语言字段约束。单元测试位于 `tests/unit`，通过 `pnpm test:unit` 执行。测试配置与脚本按测试层组织，不按实施阶段创建。
- `pnpm api:check`：重生成无漂移；另实测修改 OpenAPI 快照后检查非零退出，重生成恢复原始内容。

以上是 API/数据库/SDK 验证，不是 Projects 页面、Storybook 或浏览器 CRUD 验收。本次未运行完整 `pnpm verify`，未触发远端 CI，未迁移开发或生产数据库，未提交或推送。S7 的创建/编辑/删除、审计、译文编辑和页面闭环不在本次交付内。
