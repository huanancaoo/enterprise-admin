# S0 兼容性验收记录

日期：2026-09-15。升级前提交：`a05a5f5893f0849de1a57a68892fca69867dbcf5`。本次以当前版本为起点，选择相互兼容并能完整验收的组合；不要求每个依赖均为 latest。平台权限与 Projects 已确认规则保持不变。

**结论：兼容组合通过全仓库与 S0 验收。** 使用 Node 26.8.2、NestJS 12.0.2、TypeScript 6.0.3、Storybook 10.6.0 和 Vitest 4.1.11；保留 Nest CLI、ESLint、Jest，无 peer 冲突，无失败跳过。

## 版本来源和范围

[dependency-audit.json](dependency-audit.json) 保存 `2026-09-15T01:33:19.540Z` 官方 npm registry 查询快照。`latest`、engines、peerDependencies 描述查询到的最新版本；`selected` 表达最终采用版本；`selectionReason` 说明差异。`usedBy.spec` 是升级前声明。快照包含 Node、pnpm 和已移除的 nestjs-zod。

检查脚本确认当前 **125 个外部直接依赖声明**与 `selected` 及实际安装版本一致。内部 workspace 协议不变；传递依赖按上游范围解析并锁定。

| 组件                                     | 本次版本                                    |
| ---------------------------------------- | ------------------------------------------- |
| Node / pnpm / TypeScript                 | 26.8.2 / 12.4.1 / 6.0.3                     |
| NestJS common/core/platform-express      | 12.0.2                                      |
| Nest CLI / Swagger / Express             | 12.0.1 / 12.0.1 / 5.2.1                     |
| Better Auth / auth CLI / Drizzle Adapter | 1.7.5                                       |
| Drizzle ORM / Kit / pg                   | 0.45.2 / 0.31.10 / 8.23.0                   |
| PostgreSQL                               | 18.6，摘要见 [versions.json](versions.json) |
| Zod / Orval                              | 4.6.5 / 8.33.0                              |
| React / React DOM / Vite                 | 19.3.0 / 19.3.0 / 8.3.0                     |
| Storybook / addon-vitest / addon-a11y    | 10.6.0                                      |
| Vitest / browser-playwright              | 4.1.11                                      |
| MSW / msw-storybook-addon / Playwright   | 2.15.0 / 3.0.0 / 1.63.0                     |
| i18next / react-i18next / i18next-cli    | 26.4.2 / 17.0.14 / 1.73.3                   |
| TanStack Router / Query / Table / Form   | 1.170.36 / 5.102.8 / 9.2.4 / 1.33.5         |
| ESLint / typescript-eslint               | 10.10.0 / 8.70.0                            |
| Jest / ts-jest                           | 30.5.1 / 29.4.12                            |

Node 26 是用户指定采用的最新版本，此处不声称它是 LTS。完整直接依赖清单在审计 JSON 和各 package.json，解析结果在 pnpm-lock.yaml。

## 实际命令和结果

统一入口：仓库根目录运行 `pnpm verify`，串行执行所有验收命令。不是仅检查依赖版本，也不以探针替代生产应用构建和测试。

| 命令                                     | 结果                                    |
| ---------------------------------------- | --------------------------------------- |
| `pnpm install --frozen-lockfile`         | 通过                                    |
| `pnpm peers check`                       | 通过，无 peer 问题                      |
| `pnpm typecheck`                         | 5 个任务通过                            |
| `pnpm lint`                              | 4 个任务通过                            |
| `pnpm build`                             | API 与 Admin 两个构建通过               |
| `pnpm --filter api test --runInBand`     | 1 个单元测试通过                        |
| `pnpm --filter api test:e2e --runInBand` | 3 个 HTTP E2E 通过                      |
| `pnpm verify:s0`                         | 完整通过，无跳过项，包含 Storybook 构建 |
| `pnpm api:openapi` + `pnpm api:generate` | 生产 API OpenAPI 与客户端重新生成成功   |

### S0 探针覆盖

- NestJS 12 原生 `StandardSchemaValidationPipe` 和 Body/Path/Query Schema 编译成功。真实 HTTP 拒绝空名称、非法 UUID、额外 Body 字段及非法分页；合法 Query 字符串转换为数字。
- 同一 Zod 契约生成 OpenAPI 请求和响应，逐项验证 UUID、minLength、maxLength、required、additionalProperties；Orval 生成 SDK，TypeScript 编译成功，SDK 实际请求 Nest HTTP 端点成功。
- PostgreSQL 临时容器应用 Drizzle 迁移；非 Owner、NOSUPERUSER、NOBYPASSRLS 的 runtime 完成注册、登录、登出、Session、创建组织、切换组织、权限查询和动态角色创建。
- 五个认证组织引用列均为 UUID，业务 UUID 外键及 RLS cast 可用，事务结束后没有租户上下文不能读取测试行。后端 4 个子用例全部通过。
- Better Auth CLI 生成 Schema 与已存夹具逐字一致。
- Chromium 中 English/Arabic 两条 Story 通过：点击、MSW fetch、翻译、html.lang/html.dir；a11y 配置为 error。静态 Storybook 构建通过。
- i18next lint、extract CI、types CI、status 正向检查通过；硬编码文案、新增未提取 key、过期类型、缺失阿拉伯文翻译四类故障注入均被拒绝。

### 兼容性选择

- TypeScript 7.0.2 缺少 Nest CLI、ts-jest、typescript-eslint 需要的 JavaScript 编译器 API。采用共同支持的 **6.0.3**，无需更换构建、测试或 Lint 工具。
- Storybook addon-vitest 10.6.0 的范围支持 Vitest 3/4。采用 **Vitest / browser-playwright 4.1.11**，浏览器测试和 peer 校验同时通过。
- NestJS 12 采用 ESM。Jest 脚本统一使用 Node `--experimental-vm-modules`，单元测试与 E2E 均实际执行。没有转换第三方依赖或忽略模块错误。
- NestJS 12 原生 Standard Schema 可用，移除 nestjs-zod；HTTP 输入校验和 SDK 请求链路均保持实际验证。

## 安装配置

pnpm 12 的 `engineStrict`、`saveExact` 从 .npmrc 迁入 pnpm-workspace.yaml。对本次 latest 版本新发布时间的限制采用精确版本例外，未全局关闭发布年龄限制。构建脚本显式允许 esbuild，其余列出的脚本显式拒绝。冻结安装已成功。

Admin/Storybook 构建有大 chunk 警告；Node 有 module.register 弃用提示，Jest 有 VM Modules 实验特性提示。上述成功命令均真实返回零退出码，警告没有被当作失败，也没有被隐藏。

## 决策和复现

- [ADR-0001](../adr/0001-architecture-baseline.md) 已改为 NestJS 12 原生 Schema，移除 nestjs-zod。此前 NestJS 11 的失败不能说明当前 NestJS 不支持。
- [UUID](../adr/0002-organization-identifiers.md)、[平台权限](../adr/0003-platform-access.md)、[Projects](../adr/0004-projects-reference-domain.md) 三份业务决策未改变。
- 按 [验证工程说明](../../tools/s0/README.md) 使用 Node 26.8.2 / pnpm 12.4.1 安装，运行 `pnpm verify` 复现全部验收。
- 探针输出位于 `tools/s0/.artifacts/`，不纳入版本控制。这里不交付生产认证、完整 RLS 隔离、平台授权实现或 Projects 页面；S1–S8 不能据此宣告完成。

## 原文完整性

| 归档                       | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| multi-tenant-foundation.md | `432af43aa5c98fe33a17eeb9d351be2273a87a02f59beb79cd268b6c7cbfe376` |
| implementation-plan.md     | `b8b0438555ff4b5dfe18ab39239d49a44dffc9900c5fcb5c3ba25c473ba098f7` |

两份来源原文逐字保留，本记录与 ADR 表达本次实际决定和验收状态。

## 官方依据

- [npm registry](https://registry.npmjs.org/)：版本及 peer 元数据，已保存完整本次直接依赖快照。
- [NestJS Validation](https://docs.nestjs.com/techniques/validation)、[OpenAPI Standard Schema](https://docs.nestjs.com/openapi/introduction)。
- [Storybook React/Vite](https://storybook.js.org/docs/get-started/frameworks/react-vite)、[Vitest addon](https://storybook.js.org/docs/writing-tests/integrations/vitest-addon)。
- [TypeScript 7 发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)、[ts-jest compiler](https://kulshekhar.github.io/ts-jest/docs/next/getting-started/options/compiler)、[Jest ESM 模块支持](https://jestjs.io/docs/ecmascript-modules)。
- [Better Auth Organization](https://better-auth.com/docs/plugins/organization)、[Drizzle Adapter](https://better-auth.com/docs/adapters/drizzle)。
- [Node 官方发布索引](https://nodejs.org/dist/index.json)、[PostgreSQL 发行记录](https://www.postgresql.org/docs/release/)。
