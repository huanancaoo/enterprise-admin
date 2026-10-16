# Enterprise Admin

开源自托管的多租户企业应用基础框架。它不是后台 UI 模板，也不是以 Landing Page 为中心的 SaaS boilerplate，而是一套给二次开发用的 TypeScript 骨架：租户后台、平台后台、唯一 API Host、PostgreSQL 隔离，以及可复制的业务模块范式。

[![CI](https://github.com/huanancaoo/enterprise-admin/actions/workflows/ci.yml/badge.svg)](https://github.com/huanancaoo/enterprise-admin/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-26.8.2-339933)
![pnpm](https://img.shields.io/badge/pnpm-12.11.2-F69220)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.6-4169E1)

[功能](#功能) · [仓库结构](#仓库结构) · [快速开始](#快速开始) · [环境配置](#环境配置) · [验证](#验证) · [文档](#文档)

> [!NOTE]
> 截至 2026-10-13，确认的八项能力已完成本地实施与分层质量验证，并形成 0.1.0 自托管本地候选包：Alpine 正式发行验收 20/20 通过，同批 11 个实际镜像的 SBOM 与零 HIGH/CRITICAL 扫描通过，最终 manifest 已生成，包内公开加载入口完成镜像身份、平台与 1792 个文件的哈希核对。独立 Worker 是必需核心运行时，API HTTP 启动入口自动运行业务投递。完整证据见 [八项能力验收记录](docs/architecture/framework-completion-validation.md)；这些本机结果不代表远端 CI、GitHub 发行或实际生产部署。已有功能的历史证据见 [S8 验收矩阵](docs/architecture/s8-acceptance-matrix.md) 和 [S9 文件管理验收](docs/architecture/s9-files-validation.md)。

## 功能

- **双后台、单一 API Host**：组织成员使用租户后台，平台管理员使用平台后台；授权按成员关系或平台任职执行，不按请求来自哪个 SPA 执行。
- **Better Auth Organization**：邮箱密码登录、邮箱验证、密码重置、组织创建/选择、成员邀请与角色；组织角色不能产生平台任职。
- **租户管理**：成员目录、角色调整、移除与退出组织、邀请创建/接受/拒绝/取消/重发、自定义角色管理、个人与组织语言设置和租户审计。
- **平台管理**：部署 CLI 授予独立平台任职，MFA 自主启用；组织查询/停用/恢复、脱敏用户目录与受控敏感读取、跨组织审计、平台默认语言与部署摘要、文件配额与保留策略。
- **数据库层租户隔离**：`app_runtime` / `app_migrator` 分权，租户业务表 ENABLE/FORCE RLS，业务访问必须走 `TenantTx`。
- **Projects 参考领域**：列表、创建、详情、更新、多语言译文与富文本正文、固定版本附件、删除与结构化审计，覆盖 Schema → Repository → API → OpenAPI/Orval → 页面 → E2E。
- **Projects 导入导出**：CSV/XLSX 仅包含 `name`、`description`、`contentLocale`；原始文件最大 10 MB，XLSX 仅单工作表；导入只新增，整批校验后一次提交；导出当前已应用筛选下的全部匹配项目。任务由独立 Worker 执行，下载时重新检查当前授权。
- **通用任务中心**：聚合业务任务、Files 操作与批量任务，保留各来源的生命周期；成员看本人，owner/admin 可看组织任务。
- **个人账户安全**：两个后台共享原生密码变更、邮箱验证变更、会话查看与撤销；修改密码撤销其他会话；自主启用双重验证后，登录遵循原生验证流程。
- **对外调用凭据**：绑定现有用户与一个组织，权限取凭据范围和当前成员权限的交集；凭据到期、撤销及成员撤权作用于后续请求。
- **业务通知与 Webhook**：导入导出完成或失败生成发起人的站内通知；邮件按当前偏好发送给仍是组织成员的发起人。Projects 变更及任务结果生成薄事件，Webhook 提供签名、持久重试与投递记录；API HTTP 启动后自动运行业务投递器。
- **文件管理**：Local/S3-compatible 存储、文件夹层级、上传/覆盖与不可变版本、预览下载、引用、回收站、批量操作、配额和保留维护；个人头像独立于组织文件归属。
- **契约先于页面**：`packages/contracts` 定义 HTTP Schema，Nest 导出 OpenAPI，Orval 生成 TanStack Query 客户端。
- **i18n 与 RTL**：`zh-CN` / `en-US` / `ar`；界面语言由 i18next 持有，不写入后台 URL；内容语言与界面语言分离。
- **认证邮件**：SMTP + 本地 Mailpit，验证邮件、密码重置、组织邀请写入 durable outbox 后再投递。
- **运行观测**：受控结构化日志、HTTP/Worker traces 与任务指标；Compose 提供 Collector、Prometheus、Jaeger 及本地告警验证。
- **自托管发行与恢复**：固定 Alpine 基础镜像、不可变应用产物、同批 SBOM 与漏洞扫描、全文件哈希及离线加载入口；停写备份覆盖 PostgreSQL、Files 与 Redis，已有 Bookworm 安装通过逻辑恢复到新卷、重建索引迁移到目标排序。
- **业务模块开发指南**：以 Projects 为参考贯通 Schema、迁移/RLS、TenantTx、权限、契约、生成客户端、页面、国际化与测试，并完成独立照做验证。
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
packages/observability 仅供服务端的日志、traces 与 metrics
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

需要 **Node 26.8.2**、**pnpm 12.11.2** 和可用的 **Docker**。版本以根目录 [package.json](package.json) 的 `engines` / `packageManager` 为准。

```sh
git clone https://github.com/huanancaoo/enterprise-admin.git
cd enterprise-admin
npm install --global pnpm@12.11.2
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

使用 `platform_deployer` 的独立部署连接，替换连接串与目标用户 UUID；该命令检查用户已存在且邮箱已验证，并将任职变更与审计一同提交。平台 MFA 为可选项，未启用者可通过密码直接登录。角色初始化、已有数据库升级和撤销任职步骤见 [数据库说明](packages/database/README.md#平台任职与-mfa)。

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

正式业务和数据库验收采用固定 Alpine 发行基础镜像，由 `pnpm release:prepare` 准备；根测试入口自动执行它。已有开发 Compose 数据卷继续保持原配置，发行基线迁移见[备份与基础迁移指南](docs/guides/backup-restore.md)。

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

截至 2026-10-13，本轮本机分层门禁已通过：lint 与类型各 22/22；单元合计 187（根工作区 109、API 53、文档 25）；Nest 15/15、真实业务 HTTP 562/562、Storybook 637/637、数据库 110/110、性能 2/2；浏览器 E2E 全部 24 个文件执行退出码为 0、无失败；生产构建 12/12，以及 Schema、API 生成物、i18n 和文档内容检查通过。这些是分别执行及修正后的完整回归结果，不表示一次 `pnpm verify` 首跑全绿，也不表示远端 CI 已通过。

## 文档

- 公开开发者文档站：`apps/docs`，本地 http://localhost:3300
- [代理工作约定](AGENTS.md)：本地开发、包边界、验证入口
- [领域上下文](CONTEXT-MAP.md)：身份与组织、租户后台、平台后台
- [数据库说明](packages/database/README.md)：分权、迁移链、TenantTx
- [实施计划](docs/architecture/implementation-plan.md)：阶段范围与验收
- [业务模块开发指南](docs/guides/create-domain-module.md)：公开契约、TenantTx、授权、审计、客户端与页面的完整接入
- [自托管发行包](docs/guides/release-package.md)、[本地发布](docs/guides/local-release.md)、[升级与回退](docs/guides/upgrade.md)、[备份恢复](docs/guides/backup-restore.md)
- [观测与告警](docs/guides/observability.md)、[八项能力验收记录](docs/architecture/framework-completion-validation.md)
- [Git 协作规范](docs/agents/git.md)

[多租户基础架构原文](docs/architecture/multi-tenant-foundation.md) 与 [Email 基础设施原文](docs/architecture/email-infrastructure.md) 是归档研究。实施决策以当前代码和已接受 ADR 为准，原文建议不自动成为任务范围。
