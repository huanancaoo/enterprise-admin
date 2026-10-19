# API Host

租户后台与平台后台共用的 NestJS HTTP 服务，同时提供 `ea` 管理 CLI。业务授权由组织成员关系或平台任职决定，不依赖请求来自哪个前端。

## 开发与配置

安装、数据库准备、API 与独立 Worker 配置、启动顺序统一见[仓库快速开始](../../README.md#快速开始)。配置项以本目录的 [.env.example](.env.example) 为准。

`start`、`dev` 和 `start:debug` 加载本目录 `.env`，已有进程环境变量优先；`start:prod` 使用部署环境注入的变量。进程启动不执行数据库迁移，迁移和运行角色的边界见[数据库说明](../../packages/database/README.md)。

## 目录职责

- `src/app.module.ts`：组合领域模块与共享运行时，同一个动态模块对象由消费者共同导入。
- `src/projects`、`src/organizations`：各自的 HTTP 入口与领域提交规则。
- `src/business`：组织任务的共享查权、持久化、入队、查询和结果读取；领域事务校验在同一任务事务内执行。
- `src/platform/system`、`tasks`、`monitor`、`schedules`：平台系统管理、平台任务、监控和计划，各自拥有模块入口。
- `src/openapi`：从正式应用注册信息导出契约；快照存于 `openapi`，客户端由根目录 Orval 配置生成。

其余领域与横向能力按现有 `src` 模块组织。数据库 Schema、迁移与 Repository 位于 `packages/database`，HTTP Schema 位于 `packages/contracts`。

## 验证与发布

测试分层、运行前提和命令见[测试说明](../../docs/architecture/testing.md)。API 单元与 HTTP 测试使用 Vitest；SWC 保留 NestJS 注入依赖的装饰器元数据，生产构建仍使用 Nest CLI/TypeScript。

修改 API 注册或契约后，从仓库根目录执行 `pnpm api:openapi`、`pnpm api:generate`，审查快照和客户端差异，再通过 `pnpm api:check` 验证可重复生成。

发布遵循[自托管发行包](../../docs/guides/release-package.md)和[本地发布](../../docs/guides/local-release.md)指南。开发启动命令不替代发布流程。
