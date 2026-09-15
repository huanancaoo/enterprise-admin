# S0 兼容性验证工程

本目录用于冻结可复现技术基线，生产应用不依赖本包。探针请求没有生产租户授权能力，不能挂载到 `apps/api`。

## 运行

前置条件：Node **26.8.2**、pnpm **12.4.1**、可用的 Docker daemon。PostgreSQL 使用 [固定版本与镜像摘要](../../docs/architecture/versions.json)，由 Testcontainers 为每次测试新建并销毁，不读取业务数据库连接配置。

在仓库根目录执行：

```bash
nvm install
nvm use
npm install --global pnpm@12.4.1
pnpm install --frozen-lockfile
pnpm --filter @workspace/s0 exec playwright install chromium
pnpm verify:s0
```

Linux CI 安装浏览器系统依赖时使用 `playwright install --with-deps chromium`。仓库复现不依赖本次测试使用的临时运行时路径。

`verify:s0` 会依次检查：

1. Node/pnpm 精确版本、全部直接依赖与兼容版本记录及安装的一致性，以及 NestJS 12 原生 Standard Schema 编译成功。
2. Better Auth Schema 与配置一致。
3. 真实 PostgreSQL 迁移、注册/登录/登出、组织/角色/工作区、UUID 外键与 cast、HTTP 输入校验，以及生成 SDK 的实际 HTTP 请求。
4. i18next CLI 正常检查及四类故障注入；故障用例只修改临时副本。
5. Chromium 中的 Story 交互、MSW、i18n/RTL 与 a11y，再构建静态 Storybook。

所有检查必须成功；失败立即使命令非零退出，不跳过 Docker、浏览器或翻译验证。诊断输出写入 `.artifacts`，该目录不纳入版本控制。测试账号及密码仅在本次进程和临时数据库中存在。

## 修改验证夹具

认证配置变化后：

```bash
pnpm --filter @workspace/s0 schema:auth
pnpm --filter @workspace/s0 schema:sql
```

审查生成的 Schema/SQL 后再执行完整验证。`migrations/` 是验证夹具，不是 S2 的生产迁移目录。

文案变化后运行 `pnpm --filter @workspace/s0 i18n:generate`，补齐三个语言值。生成的认证 Schema、SDK、翻译类型使用各自生成器的格式，不手动编辑。

## 验收边界

根目录 `pnpm verify` 执行全仓库检查和本工程。探针链路通过不替代 S2 的生产数据库分权、S3 的完整多租户攻击与并发测试、S4 的真实业务授权或 S7 的 Projects E2E。结论见 [S0 验收记录](../../docs/architecture/s0-validation.md)。

## 测试运行器

后端测试由 Vitest + SWC 执行，`tsc --noEmit` 独立检查类型；4 个串行测试共享临时容器，先完成认证/组织创建，再验证 UUID/RLS。Storybook 的 2 个语言交互 Story 继续使用 Vitest 浏览器模式。`pnpm verify` 与 CI 均包含这些探针。详见 [统一测试说明](../../docs/architecture/testing.md)。
