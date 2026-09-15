# S1 验收记录

日期：2026-09-15。本文保留 S1 初次验收快照；后续测试入口与 CI 已统一 Vitest，当前状态见 [测试说明](testing.md)。范围：[实施计划 S1](implementation-plan.md#s1建立最小-monorepo-与第一版-ci)。

## 交付

- 沿用 pnpm 12.4.1、Node 26.8.2、Turborepo、共享 ESLint/TypeScript；移除 Vite Node 配置中的 `strict: false`。
- 保留现有 admin 与 API，admin 工作区名称从 `web` 改为 `admin`；新增 platform、Storybook 可运行应用。四应用加入根 `dev` / `build`。
- 补齐 admin、mocks、contracts、database、permissions、i18n 最小包，与已有 ui、api-client 形成八个包边界。新包不提供尚未实现的业务接口。
- Worker 仅预留规划目录。
- 包依赖白名单同时检查 package.json 与源码；覆盖包名、相对路径、TypeScript 解析、动态 import、require 和类型 import。
- GitHub Actions 配置 frozen-lockfile 安装与 `pnpm verify:s1`。API lint 改为只检查，不在 CI 中自动修复源码。
- 环境示例按前端公开配置、API runtime 与迁移任务分开。S1 无数据库凭据；API 读取进程变量，不自动加载 `.env`。
- API 使用 Nest ConsoleLogger 输出 JSON，记录 requestId、method、path、statusCode、durationMs。requestId 由服务端生成并放入响应 Header 与 `res.locals`；不信任外部 Header，不记录查询串、Body 或认证 Header。

## 实测

| 验证                 | 结果                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| Node / pnpm          | 26.8.2 / 12.4.1                                                             |
| frozen-lockfile 安装 | 当前目录与无 node_modules 的临时源码副本均通过                              |
| peer 检查            | 无冲突                                                                      |
| lint                 | 边界检查通过，12 个工作区任务通过                                           |
| typecheck            | 13 个工作区任务通过                                                         |
| unit                 | 依赖边界负例通过；现有 API 单元测试 1/1 通过                                |
| build                | admin、platform、api、storybook 四应用均通过                                |
| HTTP E2E             | 4/4 通过，覆盖既有 API/文档与 200、404 请求的独立 requestId                 |
| `pnpm dev`           | 四应用同时启动，API 3000 / admin 3200 / platform 3201 / Storybook 6006      |
| 浏览器               | admin Members 表格、platform 标题、Storybook UI/Button/Default 按钮实际渲染 |
| 请求日志             | 真实 HTTP 响应的 X-Request-Id 与 JSON 请求完成日志一致                      |
| 干净源码副本         | 无依赖和构建缓存执行安装、`pnpm verify:s1` 全部通过                         |

负例在临时目录构造前端直接导入数据库、相对路径导入、动态导入、类型导入、manifest 依赖，以及 contracts 导入 Drizzle；每种违规均被拒绝。合法的前端到 UI 依赖通过。另在干净副本的真实 admin 源码目录加入数据库导入，运行边界命令返回退出码 1；验证后移除该临时负例文件。

## 验收边界

GitHub Actions 工作流已落地，其命令已在本机干净源码副本跑通；尚未推送，因此没有远端 Actions 运行记录。临时副本包含本次未提交源码，并非已经发布的新 clone。

沙箱阻止本地端口监听，HTTP 测试与应用启动在获准的执行环境重跑通过。没有把端口权限错误当成应用缺陷。

本阶段不宣称完成 S2 数据库分权、S3 租户隔离、S4 认证授权、S5 业务契约或 S6 完整组件/i18n 能力。当前 JSON 日志是最小入口，S10 的 Pino/OpenTelemetry 汇总接入尚未交付。未重跑依赖 Docker 的完整 S0 探针。
