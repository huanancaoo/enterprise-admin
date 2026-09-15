# ADR-0001：多租户基础框架实施基线

- 状态：已接受，兼容组合通过完整验收
- 日期：2026-09-15
- 对应任务：S0-01、S0-02、S0-03、S0-04

## 依据与适用范围

用户指定实施 [计划 S0](../architecture/implementation-plan.md)。[研究原文](../architecture/multi-tenant-foundation.md)逐字归档，保留原始引用标记；这些标记依赖原研究会话，并非本仓库可解析的证据链接。可复核的依赖说明与实测结果见 [S0 验收记录](../architecture/s0-validation.md)。

S0 交付架构决策、精确版本及独立兼容性验证工程。归档文档中的“下一步任务”、S1–S11 和参考代码不自动成为本次实施范围。涉及业务规则，以本次用户确认和 ADR 为准。

## 决策

| 领域       | 唯一基线                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------- |
| 前端       | React + Vite；租户 `apps/admin` 与平台 `apps/platform` 两个 SPA                             |
| 后端       | NestJS 12 + Express；一个模块化单体 API Host                                                |
| 身份与组织 | Better Auth + Organization + 动态组织角色；不建立第二套 Organization/Member/Invitation/Role |
| 数据       | Drizzle ORM + pg + PostgreSQL 18.6；Drizzle Kit 生成并执行唯一 SQL 迁移链                   |
| API        | Zod 4 契约 → NestJS OpenAPI → Orval → 生成客户端                                            |
| URL 状态   | TanStack Router：组织路径、分页、已应用筛选与排序                                           |
| 服务端状态 | TanStack Query：缓存、Mutation、刷新与失效                                                  |
| 表格状态   | TanStack Table：选择、列展示等视图状态；不复制 URL 分页                                     |
| 表单草稿   | TanStack Form v1；输入时不写 Query Cache                                                    |
| 国际化     | i18next + react-i18next + i18next-cli；格式化使用 Intl；语言不进入后台 URL                  |
| UI 验证    | Storybook React/Vite + Vitest 4 + MSW 2；浏览器交互与 a11y                                  |

不引入 Next.js、Prisma、React Hook Form、React Router、ra-core 或第二套身份系统。Redis/BullMQ/Worker 只在后续实际异步需求中启用。

### NestJS 原生 Zod 接入

以当前版本为起点验证兼容性，采用 `@nestjs/common/core/platform-express@12.0.2` 和 `@nestjs/swagger@12.0.1`。此前仅验证 NestJS 11 后选用 Adapter，未评估最新主版本，不能作为最新基线的结论。

`StandardSchemaValidationPipe` 配合 `@Body({ schema })`、`@Param(name, { schema })` 和 `@Query({ schema })` 校验输入；响应使用 `@ApiCreatedResponse({ standardSchema })`。Swagger 自动转换同一份 Zod Schema，Orval 生成客户端。已移除 `nestjs-zod`，没有第二份字段定义。

[原生能力探针](../../tools/s0/fixtures/native-standard-schema.ts.txt)必须编译成功。真实 HTTP、OpenAPI 字段约束、生成 SDK 的编译及请求也必须通过。

### 包与数据边界

- `packages/ui` 持有通用组件；`packages/admin` 持有不绑定具体业务实体的后台组件。
- `packages/contracts` 持有 HTTP Schema；`packages/api-client` 由 OpenAPI 生成；前端不直接导入数据库 Schema。
- `packages/database` 持有 Drizzle Schema、Pool 和迁移；租户业务 Repository 只接收 TenantTx。
- `packages/permissions` 持有固定 Permission Statement；Better Auth Organization 持有组织角色及成员关系。
- `packages/mocks`、`packages/i18n` 分别持有共享 Mock 与 Git 翻译目录；租户内容译文存数据库。
- `tools/s0` 是独立开发验证工程，生产应用不依赖它。其探针端点、测试账号和临时数据库不进入生产 API。

以上是后续阶段的目标边界，不表示 S1 的所有应用与包现已建立。

### 数据库与部署

租户 Repository 显式按 organizationId 筛选，同时在同一个事务内设置 transaction-local 租户上下文并使用 RLS。身份、Membership 读取先于可信 TenantContext 建立，不对认证表机械套用业务 RLS。

生产 runtime 不拥有表、不具备 DDL/SUPERUSER/BYPASSRLS。bootstrap、migrator、runtime 分权；API/Worker 启动不执行迁移。迁移失败必须停止部署。生产分权与完整隔离验收属于 S2/S3。

默认自托管依赖是静态 SPA、NestJS API 和 PostgreSQL；核心闭环不要求商业 SaaS、Redis 或 Kubernetes。

## 精确版本与复现

依赖选择以兼容及完整验收通过为目标，不要求每个包都采用 latest。

- [versions.json](../architecture/versions.json)：Node 26.8.2、pnpm 12.4.1、PostgreSQL 18.6 与镜像摘要。
- [dependency-audit.json](../architecture/dependency-audit.json)：`latest` 保留官方查询快照，`selected` 记录实际采用版本，`selectionReason` 说明差异；`usedBy.spec` 是升级前声明。
- TypeScript 6.0.3 满足 Nest CLI、typescript-eslint 与 TypeDoc 的共同范围。TS 7.0.2 缺少它们使用的编译器 API，不纳入本次兼容组合。
- Storybook 10.6.0 配合 Vitest / browser-playwright 4.1.11 和 Vite 8.3.0，满足 peer 范围，浏览器交互、a11y 和静态构建通过。
- 测试运行器统一为 Vitest 4.1.11；NestJS 测试通过 SWC 保留装饰器元数据。移除 Jest、ts-jest 与 `--experimental-vm-modules` 测试入口；生产构建不变。见 [测试说明](../architecture/testing.md)。
- 所有外部直接依赖固定精确版本，内部依赖保留 workspace 协议；传递依赖以 `pnpm-lock.yaml` 为准，安装使用 `--frozen-lockfile`。
- pnpm 12 的 `engineStrict` / `saveExact` 放在 `pnpm-workspace.yaml`。近期发布包仅有精确版本年龄例外；构建脚本显式允许 esbuild，其余列出的脚本拒绝执行。

根目录 `pnpm verify` 依次执行 peer 检查、`verify:s1`（Lint、类型、边界/API 单元、HTTP、正式 Storybook 测试与构建）和完整 S0 探针。所有命令都必须成功，具体覆盖见 [S0 验收记录](../architecture/s0-validation.md)。

## 相关决策

- [ADR-0002：组织标识](0002-organization-identifiers.md)
- [ADR-0003：平台授权和跨租户访问](0003-platform-access.md)
- [ADR-0004：Projects 业务规则](0004-projects-reference-domain.md)
