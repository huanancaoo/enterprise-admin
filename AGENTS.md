# AGENTS.md

## 工作原则

- 使用中文沟通。先明确原始问题、目标和约束；存在影响实现的歧义时，先向用户澄清。
- 实现严格限定在已明确的需求内；不引入兼容、补丁、兜底、降级或改变业务语义的额外分支。
- 注释解释业务意图、关键约束、时序和边界条件；简单可读的代码无需复述。
- 完成时说明修改结果、实际验证及尚未验证的边界。构建通过不能替代业务流程验收。

## 开始任务

1. 修改文件或执行 Git 操作前，阅读 [Git 协作规范](docs/agents/git.md)，完成其中的工作区、分支和暂存区检查。
2. 探索领域或调整架构前，阅读 [领域文档规则](docs/agents/domain.md) 与相关 ADR；用 [实施计划](docs/architecture/implementation-plan.md) 确认任务范围，用当前实现确认完成状态。
3. 代码发现优先使用 codebase-memory-mcp：先 `list_projects`，未索引时执行 `index_repository`；用 `search_graph` 定位符号、`trace_path` 追踪调用、`get_code_snippet` 阅读实现、`query_graph` 查询复杂关系、`get_architecture` 查看结构。字符串、配置、文档或图结果不足时使用 `rg`；图查询无结果不等于代码不存在。

## 项目与边界

多租户企业应用基础框架，使用 pnpm workspace 与 Turborepo，主要技术为 TypeScript、React/Vite、NestJS、PostgreSQL/Drizzle 和 Better Auth。架构依据见 [ADR-0001](docs/adr/0001-architecture-baseline.md)。

理解整体设计、追溯选型理由或设计跨模块能力时，阅读 [多租户基础架构原文](docs/architecture/multi-tenant-foundation.md) 的相关章节。该文档是归档研究；实施决策以用户确认和已接受 ADR 为准，精确版本以当前配置为准，原文建议不自动成为任务范围。

- `apps/admin` / `apps/platform`：租户后台与平台后台；`apps/api`：HTTP 服务；`apps/storybook`：公共组件工作台。
- `packages/ui` 放通用 UI，`packages/admin` 放业务无关后台组件；具体业务留在应用内。
- `packages/contracts` 定义 HTTP Schema，`packages/api-client` 承载客户端；数据库能力位于仅供服务端使用的 `packages/database`。
- 修改跨包依赖时运行 `pnpm lint:boundaries`。边界规则以 `packages/eslint-config/boundaries/check.mjs` 为准。

## 安装与开发

命令均从仓库根目录执行。Node 与 pnpm 版本以 [package.json](package.json) 的 `engines` / `packageManager` 为准；工作区启用严格版本检查。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

单独启动使用 `pnpm --filter admin dev`、`pnpm --filter platform dev`、`pnpm --filter api dev` 或 `pnpm --filter storybook dev`。其他包命令先查对应 `package.json`，过滤名称使用其 `name` 字段。

- 配置前端时查看对应应用的 `.env.example`；`VITE_` 变量会暴露给浏览器，只存公开配置。
- 运行 API 时按 `apps/api/.env.example` 注入进程环境变量，API 不自动加载 `.env`。认证流程需要数据库与认证密钥，不能依据早期 S1 的无数据库说明验收当前流程。
- 配置数据库、生成 Schema、执行迁移或修改租户 Repository 前，阅读 [数据库说明](packages/database/README.md)，遵守角色分权、迁移链和 TenantTx 约束。

## 修改约定

- 使用所属包的 ESLint、TypeScript 和 Prettier 配置。修改共享配置前阅读 [ESLint 说明](packages/eslint-config/README.md) 或 [TypeScript 说明](packages/typescript-config/README.md)。
- 新增或修改 React 表单前，阅读 [表单规范](docs/agents/forms.md)，统一使用 TanStack Form、Zod 与 shadcn/ui `Field` 结构。
- 添加 shadcn 组件从 `apps/admin` 的配置入口操作，公共组件归入 `packages/ui`。
- 修改 API 生成链时查看 [Orval 配置](orval.config.ts)：先运行 `pnpm api:openapi`，再运行 `pnpm api:generate`，审查快照与生成客户端差异；生成目录通过源定义重新生成。
- 格式化仅针对本次修改的文件：`pnpm exec prettier --write <文件路径>`。

## 验证与构建

按改动选择检查，测试分层、运行前提与阶段证据见 [测试说明](docs/architecture/testing.md)；具体测试集合以当前脚本和 Vitest 配置为准。

| 改动范围             | 验证入口                                                  |
| -------------------- | --------------------------------------------------------- |
| 文档                 | `pnpm exec prettier --check <文件路径>`，检查相对链接目标 |
| 类型或源码           | `pnpm lint`、`pnpm typecheck`，再运行受影响测试           |
| 工程边界 / API 单元  | `pnpm test:unit`                                          |
| API HTTP             | `pnpm test:api`                                           |
| 公共组件交互与无障碍 | `pnpm test:storybook`                                     |
| 浏览器业务流程       | `pnpm test:e2e`（`tests/e2e`）                            |
| 数据库 / 租户隔离    | 按数据库说明运行对应验证                                  |
| 生产构建             | `pnpm build`；单独 Storybook 用 `pnpm build:storybook`    |

浏览器测试前运行 `pnpm --filter storybook exec playwright install chromium`；涉及 Testcontainers 的测试需要可用 Docker。API 单测可用 `pnpm --filter api test -- -t "测试名称"` 聚焦。

完整检查使用 `pnpm verify`。CI 还执行 `pnpm --filter @workspace/database test:compose`，具体步骤以 [CI 配置](.github/workflows/ci.yml) 为准。缺少运行前提时报告阻塞与未执行项。

## 发布与协作

- 发布前检查目标应用的构建配置和产物路径；数据库迁移镜像与发布门禁见数据库说明。`apps/api/README.md` 中的 Nest 模板部署示例不是本项目发布流程；部署目标或流程未明确时先澄清。
- 读取、创建或更新 Issue / 规格时，阅读 [Issue 工作流](docs/agents/issue-tracker.md)。
- 分诊或变更 Issue 标签时，阅读 [标签映射](docs/agents/triage-labels.md)。
- 提交、推送和 PR 的授权、命名及检查要求统一遵循 Git 协作规范。
