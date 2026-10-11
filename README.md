# Enterprise Admin

开源自托管的多租户企业应用基础框架。它不是后台 UI 模板，也不是以 Landing Page 为中心的 SaaS boilerplate，而是一套给二次开发用的 TypeScript 骨架：租户后台、平台后台、唯一 API Host、PostgreSQL 隔离，以及可复制的业务模块范式。

[![CI](https://github.com/huanancaoo/enterprise-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/huanancaoo/enterprise-admin/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-26.8.2-339933)
![pnpm](https://img.shields.io/badge/pnpm-12.4.1-F69220)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.6-4169E1)

[功能](#功能) · [仓库结构](#仓库结构) · [快速开始](#快速开始) · [环境配置](#环境配置) · [验证](#验证) · [文档](#文档)

> [!NOTE]
> 当前已完成认证与组织、租户隔离、Projects、成员与邀请、自定义角色、语言设置、租户审计、平台任职与 MFA、平台组织/用户/审计/设置，以及完整文件管理与业务消费的本机交付。证据见 [S8 验收矩阵](docs/architecture/s8-acceptance-matrix.md) 和 [S9 文件管理验收](docs/architecture/s9-files-validation.md)。通用 Worker 基础设施已交付并作为必需核心运行时；具体业务通知、导入导出与 Webhook 尚未接入；完整自托管发布、安全回退和备份恢复仍未完成验收，当前交付不代表生产发行版。

## 功能

- **双后台、单一 API Host**：组织成员使用租户后台，平台管理员使用平台后台；授权按成员关系或平台任职执行，不按请求来自哪个 SPA 执行。
- **Better Auth Organization**：邮箱密码登录、邮箱验证、密码重置、组织创建/选择、成员邀请与角色；组织角色不能产生平台任职。
- **租户管理**：成员目录、角色调整、移除与退出组织、邀请创建/接受/拒绝/取消/重发、自定义角色管理、个人与组织语言设置和租户审计。
- **平台管理**：部署 CLI 授予独立平台任职，当前会话 TOTP 验证；组织查询/停用/恢复、脱敏用户目录与受控敏感读取、跨组织审计、平台默认语言与部署摘要、文件配额与保留策略。
- **数据库层租户隔离**：`app_runtime` / `app_migrator` 分权，租户业务表 ENABLE/FORCE RLS，业务访问必须走 `TenantTx`。
- **Projects 参考领域**：列表、创建、详情、更新、多语言译文与富文本正文、固定版本附件、删除与结构化审计，覆盖 Schema → Repository → API → OpenAPI/Orval → 页面 → E2E。
- **文件管理**：Local/S3-compatible 存储、文件夹层级、上传/覆盖与不可变版本、预览下载、引用、回收站、批量操作、配额和保留维护；个人头像独立于组织文件归属。
- **契约先于页面**：`packages/contracts` 定义 HTTP Schema，Nest 导出 OpenAPI，Orval 生成 TanStack Query 客户端。
- **i18n 与 RTL**：`zh-CN` / `en-US` / `ar`；界面语言由 i18next 持有，不写入后台 URL；内容语言与界面语言分离。
- **认证邮件**：SMTP + 本地 Mailpit，验证邮件、密码重置、组织邀请写入 durable outbox 后再投递。
- **工程门禁**：依赖边界、类型、i18n 漂移、单元、HTTP、Storybook/a11y、浏览器 E2E、Schema 漂移、真实 PostgreSQL 测试与生成物检查。

## 仓库结构

```text
apps/tenant          租户后台（组织成员操作面）
apps/platform        平台后台（平台管理员操作面）
apps/api             NestJS API Host 与 ea CLI
apps/docs            开发者文档站（Fumadocs）
apps/storybook       公共组件工作台
apps/worker          核心后台任务运行时（独立 Node/BullMQ）
packages/ui          通用 UI primitives
packages/admin       业务无关后台组合层
packages/contracts   HTTP Schema
packages/api-client  生成客户端
packages/database    仅供服务端的 Schema、迁移、TenantTx
packages/jobs        仅供服务端的任务契约、生产者与消费者
packages/permissions 固定权限声明
packages/i18n        翻译目录与运行时
packages/mocks       共享 MSW fixtures / handlers
```

```mermaid
flowchart LR
  Tenant["租户后台 :3200"] -->|/api| API["API Host :3000"]
  Platform["平台后台 :3201"] -->|/api| API
  API --> PG[("PostgreSQL 18.6")]
  API --> Redis[("Redis 7.4.5")]
  API --> Mail["SMTP / Mailpit"]
  Worker["核心 Worker"] --> PG
  Worker --> Redis
  Docs["文档 :3300"]
  Storybook["Storybook :6006"]
```

业务接口在 `/api/v1`，认证在 `/api/auth`，开发文档在 `/api/docs`。打开对方后台的路由不是授权证明；`activeOrganizationId` 只是工作区偏好。

## 快速开始

需要 **Node 26.8.2**、**pnpm 12.4.1** 和可用的 **Docker**。版本以根目录 [package.json](package.json) 的 `engines` / `packageManager` 为准。

```sh
git clone https://github.com/huanancaoo/enterprise-admin.git
cd enterprise-admin
npm install --global pnpm@12.4.1
pnpm install --frozen-lockfile
```

### 1. 启动 PostgreSQL、Redis 与 Mailpit

```sh
cp infra/postgres/.env.example infra/postgres/.env
```

填写五个互不相同的密码。它们只在首次初始化空数据卷时生效。

```sh
docker compose --env-file infra/postgres/.env up -d postgres redis mailpit
```

PostgreSQL 绑定 `127.0.0.1:5432`，Redis 绑定 `127.0.0.1:6379`，Mailpit SMTP 为 `127.0.0.1:1025`，收件箱为 <http://127.0.0.1:8025>。

### 2. 执行迁移

```sh
cp packages/database/.env.example packages/database/.env
```

将 `MIGRATION_DATABASE_URL` 换成 `app_migrator` 与上一步的迁移密码（特殊字符必须 URL 编码），然后：

```sh
cd packages/database
node --env-file=.env src/migrate.ts
cd ../..
```

不要把这份文件注入 API。角色、授权和迁移细节见 [数据库说明](packages/database/README.md)。

### 3. 配置 API

```sh
cp apps/api/.env.example apps/api/.env
```

至少填写：

| 变量                           | 说明                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| `DATABASE_URL`                 | `app_runtime` 连接串，密码与初始化文件中的 runtime 密码一致  |
| `REDIS_URL`                    | Better Auth secondary storage，本地 `redis://127.0.0.1:6379` |
| `BETTER_AUTH_SECRET`           | 至少 32 字符的随机密钥，不可暴露给前端                       |
| `GITHUB_CLIENT_ID`             | GitHub OAuth App Client ID                                   |
| `GITHUB_CLIENT_SECRET`         | GitHub OAuth App Client Secret，不可暴露给前端               |
| `EMAIL_PAYLOAD_ENCRYPTION_KEY` | 32 字节的 64 位十六进制                                      |

`BETTER_AUTH_TRUSTED_PROXIES` 为反代 IP 或 CIDR（逗号分隔）。留空时只接受单值 `X-Real-IP` / `X-Forwarded-For`；多跳转发头必须列出实际反代地址。源站仍须只对反代可达。

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`start` / `dev` / `start:debug` 由 Nest CLI 加载 `apps/api/.env`，已有进程环境变量优先。生产 `start:prod` 使用部署环境注入的变量。

### 4. 配置 Worker 并启动应用

复制 `apps/worker/.env.example` 为 `apps/worker/.env`，配置与 API 相同的 `DATABASE_URL`（app_runtime）和 `REDIS_URL`。数据库迁移完成后，根开发入口会同时启动独立 Worker。

```sh
pnpm dev
```

| 应用      | 地址                         | 单独启动                      |
| --------- | ---------------------------- | ----------------------------- |
| 租户后台  | http://localhost:3200        | `pnpm --filter tenant dev`    |
| 平台后台  | http://localhost:3201        | `pnpm --filter platform dev`  |
| API       | http://localhost:3000/api/v1 | `pnpm --filter api dev`       |
| 文档站    | http://localhost:3300        | `pnpm --filter docs dev`      |
| Storybook | http://localhost:6006        | `pnpm --filter storybook dev` |

租户后台可注册、验证邮箱、创建组织，并在 `/app/projects/:organizationId` 使用 Projects。认证邮件在 Mailpit 收件箱中查看。

平台后台没有注册入口。目标用户先通过租户后台完成注册和邮箱验证，再由部署操作者按精确用户 UUID 授予平台任职：

```sh
pnpm --filter api build
PLATFORM_ASSIGNMENT_DATABASE_URL='postgresql://platform_deployer:...@127.0.0.1:5432/enterprise_admin' \
  node apps/api/dist/console.js platform assignment grant \
  --user-id '<verified-user-uuid>' \
  --role platform_admin \
  --reason '首次平台任职'
```

使用 `platform_deployer` 的独立部署连接，替换连接串与目标用户 UUID；该命令检查用户已存在且邮箱已验证，并将任职变更与审计一同提交。平台登录还须完成当前会话的 TOTP 验证。角色初始化、已有数据库升级和撤销任职步骤见 [数据库说明](packages/database/README.md#平台任职与-mfa)。

> [!IMPORTANT]
> Redis 是认证运行时的 secondary storage，限流与会话缓存依赖它。Worker 默认加入开发启动、Compose 与发布；配置和接入说明见 [Worker 指南](docs/guides/worker.md)。

## 环境配置

配置按执行环境分开，根目录 [`.env.example`](.env.example) 只做索引，不是统一凭据文件。

| 文件                                                     | 用途                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/tenant/.env.example`、`apps/platform/.env.example` | 公开前端配置；复制为应用目录 `.env.local` 后由 Vite 加载      |
| `apps/docs/.env.example`                                 | 文档站 Algolia / OpenRouter 配置；`NEXT_PUBLIC_` 会进入浏览器 |
| `apps/api/.env.example`                                  | API 进程变量                                                  |
| `apps/worker/.env.example`                               | 核心 Worker 的运行变量                                        |
| `infra/postgres/.env.example`                            | PostgreSQL 首次初始化，不注入 API                             |
| `packages/database/.env.example`                         | 仅迁移进程                                                    |

任何 `VITE_` 变量都可能进入浏览器，只放公开配置。runtime、migrator 与 bootstrap 凭据不得共享同一份环境文件。

## 开发

命令均从仓库根目录执行。

```sh
pnpm lint
pnpm typecheck
pnpm --filter tenant dev
```

- 新增或修改 React 表单时遵循 [表单规范](docs/agents/forms.md)：TanStack Form、Zod 与 shadcn/ui `Field`。
- 向 UI 包添加 shadcn 组件时，从 `apps/tenant` 的配置入口操作，公共组件归入 `packages/ui`。
- 修改 API 契约后运行 `pnpm api:openapi`，再运行 `pnpm api:generate`，审查 OpenAPI 快照与生成客户端差异。
- 修改跨包依赖后运行 `pnpm lint:boundaries`。前端不能依赖 `database` / API server；`contracts` 不能依赖 Drizzle；公共 UI 不绑定具体业务模块。
- 格式化只针对本次修改的文件：`pnpm exec prettier --write <文件路径>`。

## 验证

浏览器测试前安装 Chromium；涉及 Testcontainers 的测试需要 Docker。

```sh
pnpm --filter storybook exec playwright install chromium
pnpm verify
```

`pnpm verify` 顺序执行 peer 检查、依赖边界与 lint、typecheck、i18n、文档内容门禁、单元、API HTTP、固定规模性能、Storybook、浏览器 E2E、数据库 Schema 漂移、数据库测试、生产构建和 API 生成物检查。GitHub Actions 使用同一入口，并额外运行 `pnpm --filter @workspace/database test:compose`。

| 范围                 | 入口                                        |
| -------------------- | ------------------------------------------- |
| 工程边界 / API 单元  | `pnpm test:unit`                            |
| API HTTP             | `pnpm test:api`                             |
| 固定规模 HTTP 性能   | `pnpm test:performance`                     |
| 公共组件交互与无障碍 | `pnpm test:storybook`                       |
| 浏览器业务流程       | `pnpm test:e2e`                             |
| Schema 漂移          | `pnpm db:check`                             |
| 数据库 / 租户隔离    | `pnpm test:database`、`pnpm test:isolation` |
| 生产构建             | `pnpm build`                                |

分层、运行前提与阶段证据见 [测试说明](docs/architecture/testing.md)。构建通过不能替代业务流程验收。

## 文档

- 公开开发者文档站：`apps/docs`，本地 http://localhost:3300
- [代理工作约定](AGENTS.md)：本地开发、包边界、验证入口
- [领域上下文](CONTEXT-MAP.md)：身份与组织、租户后台、平台后台
- [数据库说明](packages/database/README.md)：分权、迁移链、TenantTx
- [实施计划](docs/architecture/implementation-plan.md)：阶段范围与验收
- [Git 协作规范](docs/agents/git.md)

[多租户基础架构原文](docs/architecture/multi-tenant-foundation.md) 与 [Email 基础设施原文](docs/architecture/email-infrastructure.md) 是归档研究。实施决策以当前代码和已接受 ADR 为准，原文建议不自动成为任务范围。
