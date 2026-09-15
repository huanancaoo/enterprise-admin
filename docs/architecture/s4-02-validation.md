# S4-02：登录、会话恢复与组织选择

## 交付范围

- Admin 的 `/login` 提供邮箱密码登录与注册；登录后进入 `/app/select-organization`，支持空组织状态、创建组织和切换组织。创建成功后选中新组织，刷新恢复服务端保存的选择。
- Platform 的 `/login` 使用已有账号登录，`/platform/` 仅显示账户状态；登录和租户角色都不产生平台授权。
- 两端复用 `packages/admin/auth` 的认证表单、会话处理和登出入口，认证请求仍通过各应用的 `auth-client.ts` 调用 Better Auth Client。
- TanStack Router 持有页面路径，TanStack Form 持有输入草稿，TanStack Query 持有组织查询和 Mutation 状态。QueryClient 随账号生命周期创建，登出或换账号后不复用旧缓存。Session 由 Better Auth 管理，不复制到本地存储。
- 请求期间禁用提交；失败展示错误并允许重试。组织创建失败保留草稿和当前选择，成功后清空草稿并失效组织查询。
- Admin 不再以演示成员表作为应用首页，原演示组件文件保留。

注册入口为本阶段的账号起点。成员邀请页面和对应 SMTP 接入留在 S8-01；本次没有发送邮件的流程。IdentityService、AuthorizationService、TenantContext 和受保护业务操作仍属于后续 S4 子任务。UI 文案目前为中文，完整 i18n 建设仍属于 S6。

## 弃用 API 检查

共享 Base、React、Nest TypeScript 配置启用 `@typescript-eslint/no-deprecated: error`；Base 开启 Project Service，使规则可读取类型声明中的 `@deprecated`。Storybook 的隐藏配置目录显式纳入 TSConfig，并声明 Vite 样式类型。

本次检查发现并移除：

- API、数据库与 S0 测试的 `describe.sequential`，改为 `describe(..., { concurrent: false }, ...)`，保留串行语义。
- ChartLegendContent 的 `verticalAlign`，改用 Recharts `position`，并从内容组件的公开 Props 中移除旧的对齐属性。

没有针对弃用 API 添加规则豁免。规则只能检测类型声明已标记的弃用信息，不能替代依赖文档核对。

## 浏览器验收入口

遵循架构目录约定，完整浏览器流程位于 `tests/e2e/auth.test.mjs`，由 Vitest 调度 Playwright Chromium：

```sh
pnpm test:e2e
```

运行前需使用仓库固定的 Node 26.8.2、pnpm 12.4.1，并具备 Docker 与 Chromium。测试自行创建临时 PostgreSQL 容器、执行正式 bootstrap/migration，以 `app_runtime` 启动编译后的 API，并在随机端口启动两个真实 Vite 应用。结束后关闭浏览器、服务和容器，不连接开发数据库。

覆盖以下流程，各测试使用独立浏览器上下文与独立账号：

1. 注册、刷新恢复会话、登出、旧 Cookie 失效、错误密码与纠正后重试。
2. 空组织、创建两个组织、切换、刷新保留选择、重复标识失败；检查窄屏无横向溢出。
3. Platform 登录、会话恢复与登出，没有注册、组织创建或平台管理操作入口。
4. 同一浏览器退出后注册另一个账号，不能带入第一个账号的组织。
5. 会话恢复请求网络失败时显示错误，恢复网络后重试成功。
6. 延迟真实注册请求，提交和模式切换在请求完成前均禁用，放行后进入组织页。

定位使用 role/label；UI 断言自动等待，没有固定 sleep。错误场景只阻断网络，不伪造认证成功响应。测试检查未捕获的页面异常；截图和失败 Trace 写入 Git 忽略的 `test-results/s4-02/`。

`test:e2e` 已纳入 `verify:s1`，因此 CI 的 `pnpm verify` 包含这些浏览器流程。

## 验证记录

验证日期：2026-09-15。

| 检查              | 结果                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `pnpm verify:s1`  | 通过：lint、类型检查、单元 7 项、API 8 项、Storybook 10 项、浏览器 E2E 5 项、全部应用构建 |
| `pnpm verify:s2`  | 通过：认证 Schema 无漂移，数据库与租户隔离 13 项                                          |
| S0 `test:backend` | 4 项通过，使用真实 PostgreSQL 与认证/组织接口                                             |
| S0 `test:stories` | 2 项通过                                                                                  |
| 界面检查          | 登录、组织选择和 390px 窄屏截图已检查；无横向溢出                                         |
| 弃用 API 检查     | 已实际拦截旧调用；替换后所有 12 个 lint 任务通过                                          |

代码审查分为 Standards / Spec 两个独立方向：初次分别发现测试重复代码（P3）与认证模式切换绕过提交锁（P2）。已抽取注册辅助函数，将认证 Mutation 提升至入口组件，并用先失败后通过的延迟请求测试验证修复；复审两个方向均无未解决项。

最终审查修复后，公共包 lint/typecheck、Admin/Platform 生产构建通过；全部 **6 项浏览器测试连续 5 轮通过（30/30）**。上述 S1 整体运行发生在新增慢网回归前，因此该次记录为 5 项 E2E。

S0 Storybook 的第三方工具链在 Node 26 输出 `module.register()` 弃用警告；本次仓库源码没有新增该 API 的调用，也没有关闭警告。

两个完整门禁存在实施前已有的编辑器依赖问题：

- `pnpm verify`：首步 peer 检查失败。`@tiptap/extension-bubble-menu` 与 `@tiptap/extension-floating-menu` 为 3.31.3，要求 3.31.3 的 core/pm，而现有 core/pm 固定为 3.30.3。该组合已存在于基线 `3f9af15` lockfile。
- `pnpm verify:s0`：依赖审计失败。基线 `packages/admin/package.json` 声明了 `@tiptap/extension-file-handler@3.30.3`，但 `dependency-audit.json` 缺少对应记录。

本任务不改变编辑器依赖或绕过上述门禁。单独执行实际测试并分别记录结果，不能将完整 `verify` 或 `verify:s0` 报告为通过。

## 参考

- [Better Auth Client](https://better-auth.com/docs/concepts/client)
- [Better Auth Organization](https://better-auth.com/docs/plugins/organization)
- [TanStack Router 代码路由](https://tanstack.com/router/latest/docs/routing/code-based-routing)
- [TanStack Form v1](https://tanstack.com/form/v1/docs/framework/react/guides/basic-concepts)
- [typescript-eslint no-deprecated](https://typescript-eslint.io/rules/no-deprecated/)
