---
status: accepted
date: 2026-09-15
---

# ADR-0001：采用统一的多租户应用架构

框架需要为企业二次开发提供可自托管、可测试且租户边界明确的实施路径。采用 React/Vite 双 SPA、NestJS 模块化单体、Better Auth 组织模型和 PostgreSQL，并统一契约生成、状态所有权与迁移链。这样新增领域可以复用身份、隔离和交付规则，避免各模块建立相互冲突的基础设施。

## 决策及影响

租户后台与平台后台是两个 SPA，共用一个 NestJS 12 + Express API Host；应用拆分不替代服务端授权。身份、组织、成员、邀请和动态组织角色统一使用 Better Auth Organization，固定 Permission Statement 由权限包维护，不建立第二套身份或成员模型。

数据使用 Drizzle ORM、pg 和 PostgreSQL，Drizzle Kit 生成并执行唯一 SQL 迁移链。租户 Repository 只接收 TenantTx，在同一事务内设置 transaction-local 租户上下文，并同时使用显式 organizationId 条件与 RLS；身份和成员关系读取先于可信 TenantContext 建立，不对认证表机械套用业务 RLS。

bootstrap、migrator、runtime 分权：生产 runtime 不拥有表，不具备 DDL、SUPERUSER 或 BYPASSRLS；API/Worker 启动不执行迁移，迁移失败停止部署。默认运行依赖为静态 SPA、API 和 PostgreSQL，商业 SaaS、Redis 和 Kubernetes 均不是核心闭环的前提；Redis/BullMQ/Worker 随实际异步需求启用。

HTTP 使用 Zod 4 定义唯一 Schema，通过 NestJS 原生 Standard Schema 校验与 Swagger 导出 OpenAPI，再由 Orval 生成客户端。采用原生接入，不维护 nestjs-zod Adapter 或第二份字段定义；通用 UI、业务无关后台组件、HTTP 契约、生成客户端和服务端数据库能力分别归属 packages/ui、packages/admin、packages/contracts、packages/api-client 和 packages/database，前端不直接导入数据库 Schema。

| 状态或内容                       | 唯一所有者                                                             |
| -------------------------------- | ---------------------------------------------------------------------- |
| 组织路径、分页、已应用筛选和排序 | TanStack Router                                                        |
| 服务器数据、Mutation、刷新和失效 | TanStack Query                                                         |
| 选择、列展示等表格视图状态       | TanStack Table，不复制 URL 分页                                        |
| 未提交表单草稿                   | TanStack Form v1，输入不写 Query Cache                                 |
| 系统文案                         | i18next、react-i18next 与 packages/i18n Git 翻译目录，i18next-cli 检查 |
| 租户多语言内容                   | 数据库                                                                 |
| 本地化格式                       | Intl；后台 URL 不保存语言                                              |

测试运行器统一为 Vitest，组件使用 Storybook React/Vite、MSW、浏览器交互与无障碍检查，共享 Mock 由 packages/mocks 维护。NestJS 测试使用 SWC 保留装饰器元数据，生产仍使用 Nest CLI/TypeScript 构建；不保留 Jest、ts-jest 或 experimental-vm-modules 测试入口。pnpm verify 汇总依赖、静态检查、各层测试、翻译、数据库、构建与生成物检查，任何一项失败都不能视为通过。

不引入 Next.js、Prisma、React Hook Form、React Router 或 ra-core，以保持上述状态和基础设施的单一归属。依赖版本以共同工具链的可用性和验证结果选择，不以逐包追求最新版本为目标；TypeScript 7.0.2 因缺少 Nest CLI、typescript-eslint 与 TypeDoc 所需编译器 API，未纳入基线组合。

外部直接依赖固定精确版本，内部使用 workspace 协议，传递依赖由锁文件确定，安装使用 frozen lockfile。pnpm 的 engineStrict、saveExact 配置位于 pnpm-workspace.yaml；发布年龄例外限定到精确版本，构建脚本基线只允许 esbuild，其余明确列出的脚本拒绝执行。

精确版本与镜像摘要见 [版本基线](../architecture/versions.json)，实际依赖以当前包配置和锁文件为准；测试职责、命令与历史验证见 [测试说明](../architecture/testing.md)。本 ADR 记录架构选择，不表示各阶段已经实现；交付范围见 [实施计划](../architecture/implementation-plan.md)，[归档研究](../architecture/multi-tenant-foundation.md)中的建议不自动成为实施授权。

相关边界分别由 [组织标识](0002-organization-identifiers.md)、[平台访问](0003-platform-access.md)和 [Projects 参考领域](0004-projects-reference-domain.md)决策约束。
