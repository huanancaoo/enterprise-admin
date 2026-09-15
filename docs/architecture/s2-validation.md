# S2 验收记录：数据库分权与唯一迁移链

日期：2026-09-15。S2-01 至 S2-08 本地实施及验收完成。

## 交付内容

- `compose.yaml` 提供固定摘要的 PostgreSQL 18.6 和持久化卷；`infra/postgres/bootstrap.sql` 建立 bootstrap / migrator / runtime / platform runtime 边界。
- `packages/database` 提供 pg Pool、Drizzle Schema、与 S0 决策一致的 Better Auth 配置，以及 CLI 生成的 UUID 认证 Schema。
- 唯一应用迁移链含认证结构与显式授权两个 migration。认证 Schema 由 Better Auth 生成，SQL 与 ledger 由 Drizzle 管理。
- `src/migrate.ts` 是独立 one-shot 进程，要求 `app_migrator` 身份；`Dockerfile` 和 `compose.migration.yaml` 提供独立运行配置。API 启动不会迁移，也没有注入迁移或 bootstrap 凭据。
- 新表默认不向 runtime 授权，具体授权随 migration 审查；平台只读取公开身份和组织关系的指定列。
- `pnpm verify` 增加 S2 Schema 漂移和数据库测试；CI 增加独立 Compose 镜像与持久化验证。

操作步骤、凭据隔离、grants 流程和失败时停止发布的要求见 [数据库说明](../../packages/database/README.md)。

## 实测结果

| 验证                                             | 结果                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                 | 联网按锁文件安装通过；离线缓存不完整，不能宣称离线安装通过                                 |
| `pnpm verify`                                    | 全部通过，覆盖 peer、依赖边界、lint、typecheck、单元/API/Storybook、四应用构建、S0 和 S2   |
| `pnpm db:check && pnpm test:database`            | 生成 Schema 无漂移，真实 PostgreSQL 的 5 个测试全部通过                                    |
| 独立 Dockerfile 构建                             | Node 26.8.2 / pnpm 12.4.1，固定锁文件安装，非 root 执行入口                                |
| `pnpm --filter @workspace/database test:compose` | 全新卷迁移、容器删除重建后的数据持久化、重复迁移、错误身份非零退出全部通过；临时资源已清理 |
| `git diff --check`                               | 通过                                                                                       |

数据库测试以随机密码和随机映射端口初始化临时 PostgreSQL，执行仓库实际 bootstrap SQL 和 one-shot migrator。具体证明：

1. 空库生成 8 张认证表及 2 条迁移记录；重复执行后 ledger 完全相同。
2. 应用表和 ledger 的 Owner 均为 `app_migrator`；runtime/platform 无 SUPERUSER、BYPASSRLS、创建库/角色、复制权限。
3. 两个运行身份均不能建表、建临时表、建 schema、改表、删表、TRUNCATE、读取迁移历史或切换到高权限身份；普通 runtime 不能切换为平台身份。
4. 实际 runtime 完成 Better Auth 注册、登录、会话读取、创建组织、切换组织、创建动态角色、更新用户、登出；组织关联的 5 个关键列均为 UUID。
5. 平台能读取允许的元数据，不能读取 account/session、组织 metadata 或修改组织；新建表不自动获得任何运行角色的 CRUD 权限。
6. 注入错误 SQL 后，migrator 非零退出、前置 DDL 回滚、ledger 不增加；恢复正常链后可继续执行。

## 验收边界

S2 不包括 S3 的 TenantContext / TenantTx / RLS 隔离，不包括 S4 的生产 HTTP 认证接入，也不包括 S8 的平台 Guard、组织状态、设置或审计功能。API 当前仍是 S1 入口。

migrator 已验证失败退出与事务回滚；后续发布必须依赖其成功退出。完整服务发布编排在 S10 实施，不能将本次 Compose 数据库验收等同于完整系统部署验收。

未提交、未推送；远端 GitHub Actions 尚未触发。本机通过不等同于远端 CI 已运行。
