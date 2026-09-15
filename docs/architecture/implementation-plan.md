# 多租户企业应用基础框架：实施步骤与验收清单

## 依据与范围

依据用户提供的《开源自托管多租户企业应用基础框架：合并修订技术架构》。技术选型、应用与包边界、Projects Reference Domain、国际化、隔离、迁移和自托管原则沿用该文档。

本文中的阶段编号、任务编号、实施先后顺序、建议脚本名、里程碑范围和具体验收方式，是在原架构上整理的实施建议，不是原文已有排期。未取得仓库代码，不判断现有项目完成度；文档未提供团队配置与工期，因此不指定周数。

原文出处按章节标注。原文未规定的细节列为实施决策，不视为既定架构。

## 一、实施主线

先完成可运行骨架，再证明租户隔离成立，然后打通 Projects 全链路，之后再扩展租户后台和平台后台，最后完成自托管与开源交付。

```text
S0 → S1 → S2 → S3 → S4 → S5 ─┐
       └────────→ S6 ─────────┴→ S7 → S8 → S10 → S11
                                  └→ S9（按需启用）
```

S6 的 UI、Storybook、i18n 工作在 S1 完成后即可并行。S10 是汇总发布门禁，不代表测试、日志或 CI 到最后才开始；它们随前面每个阶段一起实现。

| 里程碑 | 必须得到的结果 | 对应阶段 |
|---|---|---|
| M1：安全底座可验证 | 干净数据库迁移成功，runtime/migrator 分权，RLS 与事务上下文隔离测试通过 | S0–S3 |
| M2：参考业务闭环 | 真实登录与组织权限下，Projects 跑通数据库、API、SDK、页面、Storybook、i18n 和 E2E | S4–S7 |
| M3：双后台边界成立 | 租户成员/角色/设置与平台运营能力具有各自授权边界 | S8 |
| M4：可发布的自托管版本 | CI、Compose、升级和恢复演练、开源文档齐备 | S10–S11 |

不把 SSO、SCIM、Billing、Plugin Marketplace 或 Kubernetes 加入首个核心闭环。Redis/BullMQ/Worker 只在实际异步需求出现后启用。

## 二、逐步实施

### S0：冻结实施基线，补齐会影响返工的决策

**目标：** 开发者不再自行选择状态管理、ORM、认证系统或 API 类型来源。

- [ ] S0-01：将原文纳入 `docs/architecture/`，建立 Architecture Baseline ADR。
- [ ] S0-02：记录 Node、pnpm、PostgreSQL 和关键依赖的精确版本；原文的版本范围作为候选，不将“当前稳定版”当成可复现版本号。
- [ ] S0-03：做最小兼容性验证：NestJS/Express + Better Auth/Organization + Drizzle，以及 Zod 输入校验 → OpenAPI → Orval。
- [ ] S0-04：验证 React/Vite + Storybook/Vitest/MSW，以及 i18next-cli 的生成与检查流程。
- [ ] S0-05：确定组织 ID 类型。文档保留 UUID 与 text/ULID 的可能性，认证 Schema、业务外键、RLS cast、Contract 必须一致。
- [ ] S0-06：补充平台权限与跨租户访问 ADR：平台身份来源、权限模型、允许的操作、数据库访问路径、审计要求。原文给出了职责边界，没有给出完整实现模型。
- [ ] S0-07：细化 Projects 的状态、可筛选/排序字段、分页响应、删除语义、默认内容语言与译文 fallback。原文没有完整规定这些业务细节。

**固定边界：** React + Vite；NestJS 模块化单体；Better Auth Organization；Drizzle/pg；TanStack Router/Query/Table/Form；OpenAPI/Orval；i18next/Intl。不引入 Next.js、Prisma、React Hook Form 或第二套 Organization/Member/Role 系统。

**验收：** 关键版本可重现；兼容性验证结果有记录；平台权限与 ID 类型没有隐含假设；没有将“验证失败后允许引入 Adapter”误写成一开始必须引入 `nestjs-zod`。

**原文依据：** 执行摘要与优先实施建议；后端、认证、API 与多租户数据库边界；变更摘要与最终架构基线。

### S1：建立最小 Monorepo 与第一版 CI

**依赖：** S0。

本地实施及验收已完成，见 [S1 验收记录](s1-validation.md)。远端 CI 尚未推送触发。

- [x] S1-01：初始化 pnpm workspace、Turborepo、TypeScript strict、共享 ESLint/TypeScript 配置。
- [x] S1-02：创建 `apps/admin`、`apps/platform`、`apps/api`、`apps/storybook` 的可运行入口。
- [x] S1-03：创建 `packages/ui`、`admin`、`mocks`、`contracts`、`api-client`、`database`、`permissions`、`i18n` 的最小包边界；不一次实现所有预想组件。
- [x] S1-04：预留 `apps/worker` 的规划位置；未启用异步任务时，不要求它运行或部署。
- [x] S1-05：设置依赖边界检查：前端不能依赖 database/API server；contracts 不能依赖 Drizzle；公共 UI 不绑定 Projects 等具体业务模块。
- [x] S1-06：接入 frozen-lockfile 安装、lint、typecheck、最小 unit test、build。后续阶段逐步增加对应门禁。
- [x] S1-07：建立 `.env.example`，区分公开前端配置、API runtime 配置和迁移凭据；API 接入 requestId 与结构化日志最小入口。

**建议脚本名，需在仓库实现后才可执行：** `dev`、`lint`、`typecheck`、`test:unit`、`build`、`build:storybook`。脚本名称不是原文既有接口。

**验收：** 全新 clone 后可以按 README 安装并启动四个应用；CI 最小流程通过；模拟一次前端导入数据库包时，依赖边界检查会失败。

**原文依据：** Monorepo、迁移流程与参考业务模块；总体架构与职责边界。

### S2：建立数据库分权与唯一迁移链

**依赖：** S1。

本地实施及验收已完成，见 [S2 验收记录](s2-validation.md)。远端 CI 尚未推送触发。

- [x] S2-01：创建 PostgreSQL 本地开发服务及持久化配置。
- [x] S2-02：编写首次 bootstrap SQL，创建 `bootstrap_admin`、`app_migrator`、`app_runtime` 对应的初始化/迁移/运行边界。
- [x] S2-03：确保 runtime 不是表 Owner，没有 SUPERUSER、BYPASSRLS 或 DDL 能力，只获得必要权限；不要把 bootstrap 凭据注入 API。
- [x] S2-04：在 `packages/database` 建立 Drizzle schema、pg pool、migration 目录与配置。
- [x] S2-05：按 Better Auth 配置生成认证 Schema，再通过 Drizzle Kit 生成 SQL；不得另建一条生产认证迁移链。
- [x] S2-06：建立 one-shot migrator 命令及独立运行配置/镜像。API、Worker 启动时不执行 migration 或 `drizzle-kit push`。
- [x] S2-07：明确新建表的 grants 流程，确保后续 migration 不会遗漏运行权限或扩大权限。
- [x] S2-08：建立空库迁移测试；重复运行 migrator 时不应重复应用已执行迁移。

**实施细化：** 先区分身份/组织元数据、租户业务数据、平台数据的访问需求。原文的 `organization_id` RLS 示例针对租户业务表，不应不加区分地复制到所有认证表；身份验证和 Membership 读取需要在可信租户上下文建立前完成。

**验收：** 新数据库可通过唯一迁移链初始化；runtime 能进行必要业务操作但不能建表/改表；迁移失败时部署流程停止；API 运行配置中没有迁移账号密码。

**原文依据：** 后端、认证、API 与多租户数据库边界；Monorepo、迁移流程与参考业务模块。

### S3：完成 P0——TenantContext、TenantTx 与 RLS PoC

**依赖：** S2。这个阶段先用测试构造上下文证明数据库隔离，不必等待完整登录 UI。

- [ ] S3-01：建立包含 `organizationId`、`userId`、`membershipId`、`requestId`、`locale` 的 TenantContext。
- [ ] S3-02：实现 `runInTenant(context, work)`：开启事务，使用 transaction-local `set_config`，将同一事务对象交给 Repository。
- [ ] S3-03：建立 TenantTx 类型与数据访问约束，租户 Repository 不能退回全局 db/pool 执行业务查询。
- [ ] S3-04：建立 `projects`、`project_translations` 的最小 Schema。两表均具有 `organization_id`；译文采用 `(organization_id, project_id, locale)` 唯一约束，并建立匹配组织的复合外键。
- [ ] S3-05：对租户业务表启用 RLS，配置 `USING`、`WITH CHECK`，使用 S0 确定的组织 ID 类型。
- [ ] S3-06：Repository 继续显式加入 organization scope，不把 RLS 当成省略业务过滤的理由。
- [ ] S3-07：在真实 PostgreSQL Testcontainers 中创建 org-A/org-B，使用实际 `app_runtime` 凭据执行隔离测试。

**最低隔离用例：**

| 场景 | 必须观察到的结果 |
|---|---|
| org-A 的正常读取 | 只能取得 org-A 数据 |
| 故意漏写 organization WHERE | RLS 仍不返回 org-B 数据 |
| org-A 上下文写入 org-B organization_id | 写入失败 |
| 修改已有行的 organization_id 到另一个组织 | 修改失败 |
| A/B 并发请求复用连接池 | 不发生上下文串租户 |
| 事务提交或回滚后的连接复用 | 不继承上一租户事务上下文 |
| 没有设置租户上下文 | 不可读取租户数据，写入被拒绝 |
| org-A 译文关联 org-B Project | 约束或策略拒绝 |

**验收：** 本阶段全部测试必须通过后，才扩展大量业务模块。测试使用表 Owner 或高权限账号，不算完成 RLS 验收。测试构造的上下文不得通过生产 HTTP 接口暴露。

**原文依据：** P0 优先级；后端、认证、API 与多租户数据库边界；Tenant Isolation Suite。

### S4：接入真实认证、租户解析与授权

**依赖：** S3；认证适配代码可在前面阶段并行准备。

- [ ] S4-01：接入 NestJS Express 与 Better Auth，前端认证操作使用 Better Auth Client。
- [ ] S4-02：实现登录、登出、会话恢复、组织创建/选择所需最小流程；成员邀请需要的 SMTP 通道按实际流程接入，不强制引入队列。
- [ ] S4-03：用项目自己的 IdentityService、AuthorizationService 隔离 Better Auth 的业务调用，Organization/Member/Invitation/Role 不重复建模。
- [ ] S4-04：按请求目标 `organizationId` 验证 Session、Membership、组织状态和组织权限，再建立可信 TenantContext。
- [ ] S4-05：在 `packages/permissions` 定义文档要求的 `project:read/create/update/delete/export/translate`；声明 export 权限不等于本阶段必须实现导出。
- [ ] S4-06：将组织动作权限检查放在进入业务操作前；将需要读取实际资源才能判断的 Data Scope 放在事务内、修改前执行 Domain Policy。
- [ ] S4-07：测试登出、Membership 撤销、角色变更、组织停用后，后续受保护请求被正确拒绝。

**安全边界：** active organization 只是工作区偏好。客户端路径、Header、Body 或当前 UI 选中的组织都不是授权证明。租户管理员不是平台管理员。PermissionGate 只控制展示，不能替代 API 授权。

**验收：** 未登录被拒绝；非目标组织成员被拒绝；跨组织替换 ID 不能成功；撤销权限后旧页面上的按钮不能继续完成服务端操作。

**原文依据：** 总体架构与职责边界；后端、认证、API 与多租户数据库边界。

### S5：建立 API 契约、错误与本地化规则、生成客户端

**依赖：** S4。先用一个 Projects List 操作证明生成链，再逐项扩展。

- [ ] S5-01：在 `packages/contracts` 定义 ListQuery、Create、Update、Response、分页结果与统一错误 Schema。
- [ ] S5-02：按 S0 的验证结果接入 Zod 校验与 OpenAPI 生成；额外 Adapter 只在验证确有需要时引入。
- [ ] S5-03：固定 REST 路径规则与稳定 operationId。`/api/auth/*` 由 Better Auth Client 使用，`/api/v1/*` 由生成业务客户端使用。
- [ ] S5-04：配置 OpenAPI → Orval → `packages/api-client`，前端不手写另一套业务 DTO，不导入数据库 Schema 当 API 类型。
- [ ] S5-05：统一 HTTP 客户端对凭据、Accept-Language 和结构化错误的处理。
- [ ] S5-06：建立 Query Key Factory，并让生成客户端的使用方式服从该策略；所有租户资源 key 包含 organizationId。
- [ ] S5-07：响应真的随权限范围或 locale 改变时才加入对应 key 维度。规则适用于实际受影响的列表和详情，不只检查一个列表示例。
- [ ] S5-08：后端语言协商采用“受支持的 Accept-Language → user.preferredLocale → organization.defaultLocale → platformDefaultLocale”。每个请求使用固定 translator，不切换服务器全局语言。
- [ ] S5-09：错误逻辑依赖 code，不依赖 message；本地化响应正确提供 Content-Language，需要共享缓存时按文档处理 Vary。
- [ ] S5-10：CI 重生成 OpenAPI/Orval 并检查工作区无漂移。

**验收：** 一个字段从 Contract 修改后能反映到 OpenAPI、生成客户端和前端类型检查；非法请求被拒绝；API 错误具有 code/message/requestId/locale；两个语言不同的并发请求不会串语言。

**原文依据：** 总体架构与职责边界；后端、认证、API 与多租户数据库边界。

### S6：并行建设 UI、Storybook、MSW 与 i18n

**依赖：** S1；网络相关 Mock 随 S5 契约同步，最终在 S7 汇合。

- [ ] S6-01：在 `packages/ui` 建立最小 primitives 与 token；优先 Button/Input/Select/Dialog/Table/Skeleton 等 Projects 会使用的组件。
- [ ] S6-02：在 `packages/admin` 建立 AppShell、PageHeader、TenantSwitcher、LocaleSwitcher、PermissionGate、DataTable、FilterBar、Pagination、FormDialog、状态组件。
- [ ] S6-03：ResourceList/Create/Edit/Show 等抽象随 Projects 实际用例补齐，不先构建一个高度通用、尚未验证的 Resource Engine。
- [ ] S6-04：在 `apps/storybook` 接入公共组件、Vitest、interaction 与 a11y 检查。
- [ ] S6-05：在 `packages/mocks` 统一 fixtures、handlers、scenarios，覆盖成功、空数据、403、500、慢网络等行为。
- [ ] S6-06：在 `packages/i18n` 建立 `zh-CN/en-US/ar` 与文档规定的 namespaces；UI locale 由 i18next 持有，不加入后台 URL。
- [ ] S6-07：语言切换同步 html.lang/html.dir；使用 logical properties；验证 Sidebar、Dialog、Popover、Table、分页和方向性图标。
- [ ] S6-08：封装 Intl 格式化；语言、时区和货币保持独立，不由 organizationId 或 locale 推导同义属性。
- [ ] S6-09：关键组件维护 Default/Loading/Empty/Error/PermissionDenied/LongText/RTL 七类 Story。
- [ ] S6-10：接入翻译 lint、catalog 提取漂移、类型漂移和缺失翻译检查，并明确失败条件。

**验收：** 不启动 API/PostgreSQL，Storybook 也能复现组件各状态；RTL 与长文本可用；页面公共文案没有绕过翻译体系；UI locale 与 Router state 没有重复事实来源。

**原文依据：** 前端组件、Storybook 与国际化体系。

### S7：完成 Projects 全链路，每个操作纵向交付

**依赖：** S5、S6；复用 S3 的 Schema、Repository 和安全基础。

不要先完成所有后端接口，再一次性补前端。每个操作都推进到 Contract、SDK、页面和测试。

| 子步骤 | 后端与契约 | 前端 | 主要验收 |
|---|---|---|---|
| S7-01 列表 | List Query、Repository scope、分页/排序/筛选、OpenAPI | Router Search → Query → Table | 刷新保留筛选；切租户不串缓存；无第二份表格分页源 |
| S7-02 创建 | Create、组织动作权限、事务、审计事件 | TanStack Form + Zod → Mutation | 成功失效列表并 reset；失败保留草稿；Body 不能覆盖组织归属 |
| S7-03 详情与更新 | Get/Patch、Domain Policy、project.updated | 详情、编辑、保存 | 只能修改被授权资源；dirty 草稿不因后台刷新被静默覆盖 |
| S7-04 多语言内容 | ProjectTranslations、translate 权限、tenant scope、审计 | localized content editor | 实现已决定的 fallback；不能读写其他组织译文 |
| S7-05 删除 | Delete、Policy、事务、缓存关联契约 | ConfirmDangerAction、Mutation | 越权删除失败；成功后列表/详情缓存正确处理 |

**状态所有权：** Router 管组织路径和已应用列表条件；Query 管服务端事实；Table 管 selection/column visibility 等视图状态；Form 管未提交草稿。输入表单时不写 Query Cache。

**审计：** 实现 `project.created`、`project.updated`、`project.translation.updated` 等文档事件，存 eventCode 与结构化字段，不只存中文/英文句子。作为实施建议，成功业务变更与对应审计记录可在同一事务提交；原文没有完整规定审计失败与事务一致性策略，需记录该选择。

**验收：** Playwright 跑通 Login → Org → Create → Edit → Filter → Delete，以及语言切换和租户切换；对应 API/DB/Isolation/Story 测试同步完成。此时 Projects 必须能作为新增模块的完整范本，而不只是几个成功页面。

**原文依据：** Projects Reference Domain 验收矩阵；状态所有权；国际化与审计章节。

### S8：扩展租户管理与平台运营能力

**依赖：** S7；平台访问实现以 S0 的专项 ADR 为前提。

- [ ] S8-01：租户 Members 页面调用 Better Auth Organization 能力，完成邀请、移除与角色调整，不直接由页面写认证表。
- [ ] S8-02：租户 Roles 复用 Permission Statement 和文档选择的组织角色能力，不再创建独立重复角色系统。
- [ ] S8-03：Settings 接入用户 preferredLocale 与组织 defaultLocale；提供租户审计查询和当前语言呈现。
- [ ] S8-04：在 `apps/platform` 实现 Organizations、Users、Audit、Settings；通过独立平台授权策略保护对应 API。
- [ ] S8-05：按已决定的允许范围实现跨租户运营查询/审计，记录操作者、目标组织、操作、资源、结果与 requestId。
- [ ] S8-06：测试普通组织 owner/admin 无法提升为平台角色，也不能因访问 `/platform` 路由取得特权。

**注意：** 双 SPA 是应用边界，不是授权证明。原文未提供完整的平台权限表结构或跨租户数据库通道，不能在实现时默认为 app_runtime 增加 BYPASSRLS，也不能简单复用未经明确授权的平台“万能查询”。

**验收：** 成员变更影响后续访问；组织停用生效；平台操作可审计；平台访问通道不会改变普通租户访问的隔离保证。

**原文依据：** 总体架构与职责边界；四层权限模型；平台与租户双应用划分。

### S9：按需启用 Files、Notifications 与 Worker

**依赖：** 基础能力稳定后按需启动。本阶段不是核心部署的强制前置。

- [ ] S9-01：启用 Files 时先实现 Local/S3-compatible adapter、租户归属和上传/下载授权；加入跨租户 file ID 替换测试。
- [ ] S9-02：认证/邀请所需 SMTP 已在对应功能阶段提供；复杂通知、重试、导入导出或 Webhook 出现后再增加相应能力。
- [ ] S9-03：需要异步任务时才启用 Redis、BullMQ 与 `apps/worker`。
- [ ] S9-04：生产 payload 携带 organizationId、actorId、resourceId、locale、idempotencyKey、requestId/correlationId。
- [ ] S9-05：Worker 执行时重新检查组织状态和必要授权，再通过受控租户事务访问数据。
- [ ] S9-06：验证重试、重复执行和幂等；不把队列 Job ID 去重视为业务幂等的替代品。
- [ ] S9-07：加入角色撤销后旧任务拒绝执行、组织停用后任务拒绝执行、跨租户 resource ID 被拒绝的测试。

**验收：** 未启用本阶段功能时核心系统不需要 Redis/Worker；启用后对应隔离、权限与幂等测试进入 Release Gate。

**原文依据：** 测试、CI/CD、部署、监控与开源交付。

### S10：汇总质量门禁，验证自托管部署、升级和恢复

**依赖：** S8；启用了 S9 的功能必须带上对应测试。测试和日志在之前各阶段已逐步加入。

- [ ] S10-01：Unit 覆盖 Permission、Policy、Query Key、Locale、Formatter、Schema。
- [ ] S10-02：Storybook/Vitest 覆盖公共组件、interaction、a11y，并通过 Storybook 静态构建。
- [ ] S10-03：Nest/Supertest 验证 HTTP Contract、AuthZ、错误 code 与 locale。
- [ ] S10-04：Testcontainers PostgreSQL 验证 migration、constraint、transaction、RLS。声明 PostgreSQL 17 兼容时补充该版本矩阵；主要支持版本必须完整跑通。
- [ ] S10-05：隔离测试覆盖 GET/PATCH/DELETE/translation，以及已启用的 file/export job；检查缺少 scope 的原始查询和并发复用。
- [ ] S10-06：Playwright 覆盖真实登录、多租户、多用户 context、角色变化、CRUD、Locale/RTL。
- [ ] S10-07：生成物漂移、构建、镜像安全检查、SBOM 进入发布流水线。
- [ ] S10-08：建立 Compose 基线：反向代理、admin/platform 静态资源、API、PostgreSQL；Redis/Worker/Storage 扩展保持可选。
- [ ] S10-09：验证 `/app/*`、`/platform/*` SPA 路由刷新与 `/api/*` 转发，不把 API 错误改写为前端 HTML；验证部署环境登录、会话和登出。
- [ ] S10-10：发布顺序固定为 migrator 成功 → API → 可选 Worker → SPA → health/smoke。
- [ ] S10-11：Pino operational logs、OpenTelemetry traces/metrics、PostgreSQL audit 三者分工明确，requestId 可以关联操作与故障。
- [ ] S10-12：在干净环境测试首次安装；在已有数据环境测试升级；完成一次备份恢复演练。破坏性迁移采用文档的 Expand/Contract 路径。

**验收：** 任一关键隔离/权限/迁移测试失败都阻止发布；migrator 失败不继续 rollout；按照部署文档不依赖商业 SaaS 即可运行核心能力；能够恢复备份并重新通过 smoke test。

**原文依据：** 测试、CI/CD、部署、监控与开源交付；迁移流程。

### S11：完成扩展指南与 v0.1 开源交付

**依赖：** S10。

- [ ] S11-01：补齐 LICENSE/NOTICE、README、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、CHANGELOG、`.env.example` 和 `compose.yaml`。
- [ ] S11-02：完成架构、部署、升级与备份恢复文档。
- [ ] S11-03：编写 `docs/guides/create-domain-module.md`，逐步说明 Schema → Migration/RLS → Repository → Policy → Contract/API → OpenAPI/Orval → Router/Query/Table/Form → Storybook/i18n → Tests。
- [ ] S11-04：以一次独立开发验证检查该指南是否可用，不要求新增大量演示业务；发现必须绕过 TenantTx、手写 API 类型或复制整套状态管理时回到框架修正。
- [ ] S11-05：核对各对外功能声明与实际测试结果，不把未启用的 S9 功能写成默认已完成能力。

**建议的首个版本核心范围：** 认证与组织、成员与角色、租户隔离、Projects 完整范例、租户/平台边界、Storybook/MSW、i18n/RTL、生成 SDK、CI、Compose 与迁移/恢复文档。这个版本范围是实施建议；原文明确的延期项继续延期。

**验收：** 一个新的贡献者无需重新设计认证、隔离、权限、状态管理、迁移和国际化，就能照指南新增业务模块；一个新的自托管使用者能照 README 启动并完成核心流程。

**原文依据：** 开源交付清单；社区参考项目与最终架构基线。

## 三、建议新增的工程脚本

以下都是拟新增脚本名，需映射到本项目实际实现，不代表现在已存在或原文提供过这些命令。

| 脚本 | 职责 |
|---|---|
| `pnpm lint` | 代码规范与包依赖边界 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test:unit` | 纯函数/Schema/Policy/Query Key 测试 |
| `pnpm test:storybook` | 组件、交互、a11y |
| `pnpm build:storybook` | 独立工作台静态构建 |
| `pnpm i18n:check` | catalog、类型、硬编码与缺失翻译 |
| `pnpm api:generate` | OpenAPI 与 Orval 生成链 |
| `pnpm api:check` | 检查生成物漂移 |
| `pnpm db:generate` | 生成待审查 SQL migration |
| `pnpm db:migrate` | 使用迁移身份执行待执行 migration |
| `pnpm test:database` | 真实 PostgreSQL migration/constraint/transaction |
| `pnpm test:isolation` | 实际 runtime 身份的 RLS 与租户攻击测试 |
| `pnpm test:e2e` | 真实应用 Playwright 流程 |
| `pnpm build` | 构建本次启用的应用与包 |

不把 `db:migrate` 配置为 API/Worker 启动的自动前置任务。迁移凭据由专用执行环境提供，不因统一脚本而扩大其可见范围。

## 四、最先执行的五项任务

1. 固定基线及 ID/平台授权决策，完成最小兼容性验证。
2. 建立四个应用可运行的 Monorepo 与最小 CI。
3. 建立分权数据库与 one-shot migration。
4. 完成 Projects/ProjectTranslations 的 TenantTx + RLS，跑通真实 PostgreSQL 双租户隔离测试。
5. 接入真实身份与权限后，先让 Projects List 跑到浏览器；UI/Storybook/i18n 在此期间并行建设。

第一轮目标不是“有一套好看的后台”，而是“能证明安全边界成立，并且第一个业务模块有唯一、可复制的开发路径”。
