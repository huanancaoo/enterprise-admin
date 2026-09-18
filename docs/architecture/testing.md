# 测试框架与 Vitest 统一验收

日期：2026-09-15。测试运行器统一为 **Vitest 4.1.11**。保留 Supertest、Testcontainers、Storybook、MSW 和 Playwright 各自的职责。

## 当前测试分层

| 范围                | 执行入口（仓库根目录）       | 环境与覆盖                                                        |
| ------------------- | ---------------------------- | ----------------------------------------------------------------- |
| 工程边界与 API 单元 | `pnpm test:unit`             | Vitest Node；边界回归 5 个，Nest 注入/Controller 测试 1 个        |
| API HTTP            | `pnpm test:api`              | Vitest Node + Supertest；4 个接口、文档、requestId 测试           |
| 正式组件            | `pnpm test:storybook`        | Vitest 浏览器模式 + Storybook；Button 键盘焦点和 a11y，1 个 Story |
| API 单元覆盖率      | `pnpm --filter api test:cov` | Vitest V8 coverage；统计 API src，不包含 spec 文件                |

Node 的 `assert` 仍作为断言库使用，`node:test` 与 `node --test` 已移除。生成物检查继续使用普通 Node 命令，不引入另一套测试运行器。

## 运行方式

前置：Node 26.8.2、pnpm 12.4.1；完整验证需要可用 Docker daemon 和 Chromium。

```sh
pnpm install --frozen-lockfile
pnpm --filter storybook exec playwright install chromium
pnpm verify
```

Linux CI 使用 `playwright install --with-deps chromium` 安装浏览器系统依赖。

`verify` 按顺序执行 peer 检查、lint、typecheck、单元、API、Storybook、浏览器 E2E、数据库 Schema 漂移、数据库测试、生产构建和 API 生成物检查。CI 执行同一入口，任一步失败都停止。

API watch/debug/coverage 入口保留，均改由 Vitest 执行。正式前端业务单元测试与完整浏览器业务 E2E 尚未建立；不创建空测试来伪造覆盖。

## NestJS 编译约束

`tests/setup/nest-plugin.mjs` 是 API 测试的转译配置，使用 `unplugin-swc@1.6.0`、`@swc/core@1.16.2`，明确启用 legacy decorators 和 decorator metadata。NestJS 依赖构造函数参数的反射元数据完成注入，因此不能省略这一步。

生产构建继续使用原 Nest CLI/TypeScript 链。SWC 不进行类型检查，工作区继续执行 `tsc`。

API 测试显式从 Vitest 导入测试函数；共享 Nest TypeScript/ESLint 配置不再注入 Jest 全局类型。已移除 Jest、ts-jest、@types/jest 直接依赖、Jest 配置及专用命令参数。

## 本次实测结果

- `pnpm install --frozen-lockfile`、peer 审计通过。
- `pnpm verify` 全部通过，无测试跳过：12 个 lint 任务、13 个 typecheck 任务、四应用构建，以及上述 13 个测试。
- `pnpm --filter api test:cov` 通过，语句/行覆盖率为 **9.37%**，仅包含现有 API 单元测试；未设置新阈值，也不据此宣称覆盖充分。
- 本机通过完整入口；尚未推送，远端 GitHub Actions 尚未验证。

本次未增加登录、租户切换或 Projects 浏览器 E2E，也未更改生产业务行为。

## S2 数据库验收

S2 新增 1 个 Vitest 文件、5 个真实数据库测试，见 [S2 验收记录](s2-validation.md)。独立镜像与 Compose 持久化验证运行 `pnpm --filter @workspace/database test:compose`；使用随机项目名、随机密码和随机本机端口，结束只清理本次创建的资源。

## S4-02 浏览器流程

完整浏览器测试按架构约定放在 `tests/e2e`，运行 `pnpm test:e2e`，已纳入 `pnpm verify`。认证、组织、账号切换、网络失败与验收边界见 [S4-02 验收记录](s4-02-validation.md)。

## 契约与生成客户端测试归属

测试入口按职责组织，不为实施阶段建立单独配置：

- `tests/unit`：契约 Schema、语言协商、Query Key 和 HTTP 客户端，归入 `pnpm test:unit`。
- `tests/api/projects.test.mjs`：生成 SDK → 真实 HTTP → 临时 PostgreSQL，归入 `pnpm test:api`；该入口同时执行 `apps/api/test` 的 Nest HTTP 回归。
- 根 `vitest.config.mjs` 用 `unit` 与 `api` projects 区分这两类测试；浏览器业务流程继续使用既有 `vitest.config.e2e.mjs`。
- `pnpm api:check` 单独验证 OpenAPI/Orval 生成物漂移，并由 `pnpm verify` 调用。

## 验证代码的目录归属

验证代码按职责归入 PRD 已有的 `tests` 和所属 `packages`，不设置根级工具目录：

- `tests/setup/nest-plugin.mjs`：API 测试使用的 Nest 转译配置。
- `packages/eslint-config/boundaries`：工作区依赖边界规则与负例测试，由 `pnpm lint:boundaries` 和 `pnpm test:unit` 执行。
- `packages/api-client/scripts/check-generated.mjs`：OpenAPI 与客户端生成一致性校验，由仓库根目录的 `pnpm api:check` 执行。

## S6 UI 与翻译门禁

- `pnpm test:storybook` 覆盖公共 DataTable、RichTextEditor、Projects/MSW 列表与 FormDialog；新增组合组件的交互、RTL、长文本和 a11y 为失败门禁。
- `pnpm test:unit` 包含 `packages/mocks/tests` 的请求契约验证和 `tests/unit/i18n-ui.test.ts` 的语言实例、格式化及资源检查。
- `pnpm test:e2e` 增加真实 SPA 切语言不改 URL、不清除草稿及 html 方向验证。
- `pnpm i18n:check` 已加入 `verify`；每个命令的失败条件与验收数量见 [S6 验收记录](s6-validation.md)。

## 共享测试运行时与项目规则

- `tests/setup/test-runtime.mjs` 负责生产迁移、临时 PostgreSQL、HTTP、可选 Mailpit，以及浏览器测试的 Vite/Chromium 生命周期。资源创建后立即登记逆序释放；启动失败也释放已创建资源。每个测试文件仍拥有独立数据库。
- `startTestApplication` 用于生产 HTTP 集成，`startBrowserApplication` 用于两个后台的真实浏览器流程。浏览器代理目标归各 Vite 实例，不改进程环境变量；浏览器测试仍串行以限制资源消耗。
- MFA 的上游 Schema 实验继续使用 `startAuthProbeDatabase`，不混入生产迁移链。
- `packages/api-client/tests` 纳入根 Vitest 的 `unit` project，通过项目写入 interface 验证组织/语言缓存隔离及写入提交与读回结果的区分；页面继续管理未保存输入。
- `tests/api/projects.test.mjs` 同时保留真实 HTTP 授权与回滚验证，并通过 Projects module 验证项目译文规则。`tests/api/platform-assignment.test.mjs` 经真实 CLI 验证无邮件配置也能创建可登录的平台管理员。

运行时严格使用仓库 `.node-version` / `.nvmrc` 指定的 Node 版本；共享运行时使用该版本提供的 `AsyncDisposableStack`。
