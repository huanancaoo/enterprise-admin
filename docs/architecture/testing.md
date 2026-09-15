# 测试框架与 Vitest 统一验收

日期：2026-09-15。测试运行器统一为 **Vitest 4.1.11**。保留 Supertest、Testcontainers、Storybook、MSW 和 Playwright 各自的职责。

## 当前测试分层

| 范围                | 执行入口（仓库根目录）                     | 环境与覆盖                                                        |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| 工程边界与 API 单元 | `pnpm test:unit`                           | Vitest Node；边界回归 5 个，Nest 注入/Controller 测试 1 个        |
| API HTTP            | `pnpm test:api`                            | Vitest Node + Supertest；4 个接口、文档、requestId 测试           |
| 正式组件            | `pnpm test:storybook`                      | Vitest 浏览器模式 + Storybook；Button 键盘焦点和 a11y，1 个 Story |
| S0 后端兼容性       | `pnpm --filter @workspace/s0 test:backend` | Vitest Node + Testcontainers PostgreSQL；4 个串行测试             |
| S0 浏览器兼容性     | `pnpm --filter @workspace/s0 test:stories` | Vitest + Chromium + MSW；英文、阿拉伯语交互及 a11y，2 个 Story    |
| API 单元覆盖率      | `pnpm --filter api test:cov`               | Vitest V8 coverage；统计 API src，不包含 spec 文件                |

合计 **6 个测试文件、13 个测试**。S0 后端覆盖真实认证/组织、UUID/RLS cast、HTTP 输入校验及 OpenAPI → Orval → 实际 SDK 请求。这仍是兼容性探针，不代表正式租户隔离和 Projects 业务已经实现。

Node 的 `assert` 仍作为断言库使用，`node:test` 与 `node --test` 已移除。i18n/依赖校验和生成脚本继续使用普通 Node 命令；它们不引入另一套测试运行器。

## 运行方式

前置：Node 26.8.2、pnpm 12.4.1；完整验证需要可用 Docker daemon 和 Chromium。

```sh
pnpm install --frozen-lockfile
pnpm --filter storybook exec playwright install chromium
pnpm verify
```

Linux CI 使用 `playwright install --with-deps chromium` 安装浏览器系统依赖。

- `verify:s1`：依赖边界检查、lint、typecheck、边界/API 单元、HTTP、正式 Storybook 测试、四应用构建。
- `verify:s0`：依赖版本审计、原生 Standard Schema 编译探针、认证 Schema 漂移、后端数据库链、翻译正反向检查、S0 浏览器测试及构建。
- `verify`：peer 检查 → `verify:s1` → `verify:s0`。CI 执行这一完整入口，任一步失败都停止。

API watch/debug/coverage 入口保留，均改由 Vitest 执行。正式前端业务单元测试与完整浏览器业务 E2E 尚未建立；不创建空测试来伪造覆盖。

## NestJS 编译约束

`tools/testing/nest-plugin.mjs` 是 API 与 S0 后端共用的测试转译配置，使用 `unplugin-swc@1.6.0`、`@swc/core@1.16.2`，明确启用 legacy decorators 和 decorator metadata。NestJS 依赖构造函数参数的反射元数据完成注入，因此不能只替换 Jest 命令而省略这一步。

生产构建继续使用原 Nest CLI/TypeScript 链。SWC 不进行类型检查，保留工作区 `tsc`，S0 后端测试前执行 `tsc --noEmit`。

API 测试显式从 Vitest 导入测试函数；共享 Nest TypeScript/ESLint 配置不再注入 Jest 全局类型。已移除 Jest、ts-jest、@types/jest 直接依赖、Jest 配置及专用命令参数。

## S0 生命周期

S0 后端通过 `describe.sequential` 保留步骤顺序：UUID 用例依赖认证用例创建的组织。容器和应用在 `beforeAll` 初始化，`afterAll` 按 HTTP → runtime pool → owner pool → container 清理；初始化失败时也释放已取得的资源。测试和 hook 超时各为 180 秒。

SDK 仍由 Orval 生成、由 TypeScript 编译并实际调用；因测试改为从源码执行，产物导入路径同步改为源码目录相对路径。

`tools/s0` 继续保留兼容性工程。正式 Storybook 已接入自身的测试；S0 浏览器探针仍留在 S0，避免正式组件工作台依赖验证工程。删除 S0 需要另行落实其验证能力的归属。

## 本次实测结果

- `pnpm install --frozen-lockfile`、peer 审计通过。
- `pnpm verify` 全部通过，无测试跳过：12 个 lint 任务、13 个 typecheck 任务、四应用构建，以及上述 13 个测试。
- S0 翻译 lint、catalog/type 漂移、缺失翻译的正常与负例检查通过。
- `pnpm --filter api test:cov` 通过，语句/行覆盖率为 **9.37%**，仅包含现有 API 单元测试；未设置新阈值，也不据此宣称覆盖充分。
- 本机通过完整入口；尚未推送，远端 GitHub Actions 尚未验证。

本次未增加登录、租户切换或 Projects 浏览器 E2E，也未更改生产业务行为。
