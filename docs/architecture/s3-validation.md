# S3 验收记录：TenantContext、TenantTx 与 RLS

日期：2026-09-15。S3-01 至 S3-07 本地实施及隔离验收完成。

## 交付范围

- TenantContext 包含 organizationId、userId、membershipId、requestId、locale。`createTenantRunner(pool)` 返回 `runInTenant(context, work)`，在同一事务设置 transaction-local 组织上下文并执行 Repository。
- TenantTx 使用不可由普通 db/Pool 满足的品牌类型，Repository 从事务上下文取得组织 ID，并显式限定查询范围。依赖边界门禁禁止 Repository 导入连接、全局 db 和事务工厂。
- Projects 与 ProjectTranslations 使用 UUID、组织复合外键、组织/项目/语言唯一约束；状态和语言沿用 ADR-0004。创建同时写入基础译文，删除级联译文。
- 唯一 Drizzle 迁移链新增结构迁移 `0002_projects.sql` 和策略/授权迁移 `0003_tenant-rls.sql`。两表 ENABLE/FORCE RLS，USING 与 WITH CHECK 使用 ADR-0002 的 UUID 表达式。仅 app_runtime 获得两表 CRUD 权限。
- 根 `pnpm verify` 的数据库测试自动覆盖 S3；`pnpm test:isolation` 可单独复现隔离测试。

## 隔离用例

测试在临时 PostgreSQL 18.6 Testcontainers 上运行仓库 bootstrap 和 one-shot migrator，再以真实 app_runtime 登录。组织和业务数据也由 runtime 创建；隔离断言不使用 Owner 或 bootstrap 身份。

| 用例            | 验证内容                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| 身份及表策略    | runtime 非 Owner、无 SUPERUSER/BYPASSRLS，两表均强制 RLS                                            |
| 读取隔离        | A/B 各自 Repository 读取与漏写 WHERE 的 SQL 均只返回本组织                                          |
| 写入隔离        | 两表跨组织 INSERT、修改 organization_id 均返回 SQLSTATE 42501                                       |
| 译文关联        | A 译文引用 B Project 被复合外键拒绝；相同组织/项目/语言重复写入被唯一约束拒绝                       |
| 无上下文        | 两表查询为空，INSERT 被拒绝                                                                         |
| 连接复用        | 24 个 A/B 并发请求排队复用同一连接，核对 backend PID 与组织；提交和回滚后上下文清空，回滚数据不保留 |
| 原子业务写入    | 基础译文失败导致 Project 回滚；创建默认 draft，删除级联译文                                         |
| 跨组织更新/删除 | 不含 organization WHERE 的 UPDATE/DELETE 对另一组织两表均影响零行                                   |

另有 TypeScript 负向检查，证明普通 Pool/db 不能作为 TenantTx；边界故障注入覆盖 Pool、Drizzle 连接入口、全局 db、事务工厂、动态导入和再导出。

## 实测结果

- Node 26.8.2 下 `pnpm verify` 全部通过：peer、lint、typecheck、6 项边界测试、API 单元及 HTTP 测试、Storybook、四应用构建、S0 和数据库验收。
- 真实数据库测试 13/13 通过：S2 回归 5 项，S3 隔离 8 项。
- `pnpm verify` 的边界、类型、lint 和数据库测试通过；后续新增的跨组织 UPDATE/DELETE 用例也在完整验证中通过。
- 认证 Schema 重生成无漂移。
- `pnpm --filter @workspace/database test:compose` 通过：独立镜像构建、四条迁移、数据卷重建持久化、重复迁移、错误身份退出；临时容器、卷和镜像已清理。
- `git diff --check` 通过。

## 复现与边界

按 `.nvmrc` 使用 Node 26.8.2，并提供可用的 Docker。默认 shell 的 Node 22.19.0 会被 S0 版本门禁拒绝；沙箱无法访问 Docker 时不能视为数据库测试通过。

S3 只证明数据库事务隔离。测试上下文不通过生产 HTTP 暴露；真实 Session/Membership/组织状态与权限检查属于 S4。Projects 完整分页、语言解析、审计与 HTTP/UI 业务闭环属于 S5–S7，不能据此宣布已完成。

未提交、未推送，远端 CI 未触发。
