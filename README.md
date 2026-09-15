# Enterprise Admin

多租户企业应用基础框架。架构依据见 [ADR-0001](docs/adr/0001-architecture-baseline.md)，阶段范围见 [实施计划](docs/architecture/implementation-plan.md)。

## 本地运行

安装 Node **26.8.2** 与 pnpm **12.4.1**，在仓库根目录执行：

```sh
npm install --global pnpm@12.4.1
pnpm install --frozen-lockfile
pnpm dev
```

| 应用      | 地址                         | 单独启动                      |
| --------- | ---------------------------- | ----------------------------- |
| 租户后台  | http://localhost:3200        | `pnpm --filter admin dev`     |
| 平台后台  | http://localhost:3201        | `pnpm --filter platform dev`  |
| API       | http://localhost:3000/api/v1 | `pnpm --filter api dev`       |
| Storybook | http://localhost:6006        | `pnpm --filter storybook dev` |

S1 四个入口不依赖 PostgreSQL、Redis 或外部账号。API 的开发文档位于 `/api/docs`。当前后台是开发骨架，认证、租户隔离与业务功能按后续阶段交付。Worker 仅有规划目录，未加入启动任务。

## 环境配置

默认配置即可启动 S1。公开前端配置分别位于 `apps/admin/.env.example`、`apps/platform/.env.example`；如需增加公开变量，将示例复制为应用目录的 `.env.local`，由 Vite 加载。任何 `VITE_` 变量都可能进入浏览器。

API 使用进程环境变量，示例见 `apps/api/.env.example`。例如 `PORT=3100 pnpm --filter api dev`。API 不自动读取 `.env` 文件。

S2 已提供 PostgreSQL 本地服务、数据库分权与独立迁移镜像，操作见 [数据库说明](packages/database/README.md)。`infra/postgres/.env.example` 只供首次初始化，`packages/database/.env.example` 只供迁移；runtime 凭据只注入 API，不能共享同一份环境文件。当前 API 仍不连接数据库。

## 验证

```sh
pnpm --filter storybook exec playwright install chromium
pnpm verify
```

所有测试运行器统一为 Vitest 4.1.11。`pnpm verify` 顺序执行 peer、依赖边界与 lint、typecheck、单元、API HTTP、Storybook、浏览器 E2E、数据库 Schema 漂移与数据库测试、生产构建及 API 生成物检查。GitHub Actions 使用相同入口；需要可用 Docker 与 Chromium。`pnpm build:storybook` 可单独构建组件工作台。

依赖检查同时扫描 package.json 和源码 import/export、动态 import、require、类型 import；限制前端到服务端、contracts 到 ORM、公共 UI 到业务应用的依赖，并检查相对路径与 TypeScript 解析到的别名。负例测试见 `packages/eslint-config/boundaries/check.test.mjs`。

测试按正式工程职责归入应用、包及根目录 `tests`；具体分层见 [测试说明](docs/architecture/testing.md)。

## 应用与包边界

- `apps/admin`、`apps/platform`：租户与平台 SPA。
- `apps/api`：NestJS API Host，输出 JSON operational logs；每个请求生成独立 `X-Request-Id`，日志不记录查询串、请求体和认证 Header。
- `apps/storybook`：可独立启动的公共组件工作台。
- `packages/ui`：通用组件；`packages/admin`：业务无关后台组件。
- `packages/contracts`：HTTP Schema；`packages/api-client`：生成客户端。
- `packages/database`：服务端数据库边界；`packages/permissions`：固定权限声明。
- `packages/mocks`、`packages/i18n`：共享 Mock 与翻译目录。

新增的空包仅声明边界，具体功能随相应阶段实现。向 UI 包添加 shadcn 组件时，从 `apps/admin` 配置入口操作。
