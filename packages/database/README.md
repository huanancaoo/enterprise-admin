# Database（S2–S3）

`@workspace/database` 仅供服务端使用。认证配置采用 [Better Auth Drizzle 生成链](https://better-auth.com/docs/adapters/drizzle)，认证 Schema 不手改。部署只执行本包的 `migrations`。

## 本地 PostgreSQL

1. 将 `infra/postgres/.env.example` 复制为 `infra/postgres/.env`，填写四个独立密码。仅在首次初始化空数据卷时使用它们；修改文件不会改变已有角色密码。
2. 启动数据库：

   ```sh
   docker compose --env-file infra/postgres/.env up -d postgres
   ```

数据库固定为 PostgreSQL 18.6，镜像摘要与 `docs/architecture/versions.json` 一致。端口只绑定本机，默认 5432；冲突时调整 `POSTGRES_PORT`。命名卷挂载 PostgreSQL 18 的 `/var/lib/postgresql`，普通 `docker compose down` 保留数据。

## 唯一迁移链

```sh
pnpm db:generate
```

先由固定版本 Better Auth CLI 读取 `auth.config.ts` / `src/auth.ts` 生成认证 Schema，再由 Drizzle Kit 生成 SQL 和快照。此命令不读取数据库凭据、不连接数据库。

新增表时必须审查所属身份域、租户业务域或平台域，并在同一发布的 migration 中加入明确表名、角色和必要操作的 GRANT。不要使用 `ON ALL TABLES` 或默认自动授权；新增表默认没有 runtime 权限。UUID 主键不需要序列授权；将来若使用序列，按具体序列授予必要权限。租户业务表必须同时建立 RLS 和 TenantTx 访问路径；不把组织隔离策略复制到登录前需要访问的认证表。

结构迁移生成后，需要新增授权或其他手写 SQL 时运行：

```sh
pnpm --filter @workspace/database exec drizzle-kit generate --custom --name=describe-the-grant
```

把授权 SQL 写入生成的文件，与结构迁移一起审查。已执行的 migration 不修改；新变更使用新文件。按提交顺序串行运行一个 migrator，禁止并发执行迁移。

### 本机 one-shot 进程

从 `packages/database/.env.example` 创建专用 `.env`，填入迁移 URL（密码中的特殊字符必须 URL 编码）。本机地址使用 localhost 和实际端口。仅将该环境注入迁移进程：

```sh
cd packages/database
node --env-file=.env src/migrate.ts
```

若执行环境已注入 `MIGRATION_DATABASE_URL`，可在根目录运行 `pnpm db:migrate`。脚本要求真实连接身份为 `app_migrator`，成功退出 0，缺配置、错误身份或迁移失败均非零退出。Drizzle ledger 位于 `drizzle.__drizzle_migrations`，重复执行不重放已记录的迁移。待执行 SQL 和 ledger 记录在事务中提交；失败回滚。迁移 SQL 必须能够在事务中执行。

### 独立镜像

为 Compose 另建 `packages/database/.env.compose`，仅设置 `MIGRATION_DATABASE_URL`；主机名使用 `postgres`，端口使用容器内的 5432。镜像不会复制环境文件。

```sh
docker compose --env-file infra/postgres/.env \
  --env-file packages/database/.env.compose \
  -f compose.yaml -f compose.migration.yaml \
  run --build --rm migrator
```

此命令等待数据库 healthy 后执行迁移，并返回迁移进程退出码。部署脚本必须用 `migrator 命令 && 后续服务发布命令` 建立成功门禁，或启用 shell `set -e`；非零时停止发布。S2 只交付数据库与 migrator 配置，完整 API/SPA 发布编排在 S10。

API / Worker 启动脚本不运行迁移。运行账号、平台账号、迁移账号与 bootstrap 密码分别配置；禁止向 API/Worker 注入 bootstrap 或 migrator 环境文件。

## 创建平台管理员

平台后台没有注册。用与 API 相同的 runtime 连接和认证配置创建用户并写入平台任职；创建后将邮箱标为已验证，不入队验证邮件。邮箱已被占用时失败，不会改已有用户。命令只读取 `DATABASE_URL` 和 `BETTER_AUTH_*` 身份配置，不要求 SMTP 或 `EMAIL_*` 配置；HTTP 运行时仍要求完整邮件配置。

```sh
ea platform admin create --email admin@example.test --password 'your-password' --name 平台管理员
```

## 角色和访问范围

| 角色               | 权限                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap_admin`  | PostgreSQL 镜像初始化角色，拥有数据库；只用于首次初始化/运维                                                                                                                                                            |
| `app_migrator`     | 非超级用户，可建 schema、持有应用表和迁移 ledger；无创建数据库/角色或 BYPASSRLS 权限                                                                                                                                    |
| `app_runtime`      | 非 Owner；认证八表、`email_messages` 及 RLS 约束下的 Projects 两表 SELECT/INSERT/UPDATE/DELETE；audit_events 仅 SELECT/INSERT；platform_assignment 仅 SELECT/INSERT；无 DDL、TEMP、TRUNCATE、迁移 ledger 或角色切换权限 |
| `platform_runtime` | 非 Owner；只读 user 公开身份列、organization 运营列和 member 关系列；无 account/session/verification 权限                                                                                                               |

组织运营状态的唯一来源是 `organization_status`（ACTIVE/SUSPENDED 及授权版本）。新组织由 INSERT 触发器初始化为 ACTIVE；缺失状态拒绝访问。`app_runtime` 可读状态与授权版本、可更新 `authorization_version`，不能改 `status`；`platform_runtime` 不能读写该表。平台停用/恢复 HTTP 仍属于后续任务；测试用 migrator 夹具布置状态。

服务端通过 `createDatabase(runtimeUrl)` 获取 `pool` 和类型化 `db`，调用者在退出时执行 `pool.end()`。包不会自动连接或读取迁移变量。`createAuth(pool, baseURL, secret)` 提供与生成器相同的认证配置；真实 HTTP 接入和密钥注入在 S4 完成。

## 验收

```sh
pnpm db:check
pnpm test:database
```

先检查 Better Auth Schema 生成漂移，再在新的 Testcontainers PostgreSQL 中执行真实 bootstrap、两次 one-shot migration、Owner/权限断言、runtime 认证/组织操作、平台列权限、新表默认无授权、失败迁移回滚及非零退出。测试使用随机密码、随机映射端口，不读取开发数据库 URL；结束后销毁测试容器。

独立镜像与 Compose 持久化复现：`pnpm --filter @workspace/database test:compose`。它构建镜像，使用随机项目名与端口，验证容器删除重建后的数据保留及 migrator 非零退出，最终删除本次测试创建的容器、卷和镜像。

## 租户事务与 Repository（S3）

组合入口从 `@workspace/database/tenant` 导入 `createTenantRunner(pool)`，得到 `runInTenant(context, work)`。context 必须包含 organizationId、userId、membershipId、requestId、locale。S4-04 的 `TenantGuard` / `TenantContextService` 按目标组织验证身份、成员、组织状态和权限后生成上下文，业务处理器通过 `CurrentTenant` 获取；请求体不能直接构造可信上下文。S3 数据库测试仍使用内部测试上下文。

`runInTenant` 冻结上下文副本，在同一 Drizzle 事务内执行 transaction-local `set_config`，再将 TenantTx 交给 work；成功提交，抛错回滚。回调必须等待所有查询完成，不能保存事务供回调结束后使用。它不负责登录、成员资格或组织权限验证。

`@workspace/database/repositories/projects` 提供 S3 的最小创建、读取、译文读取和删除操作。所有读取和删除显式限定组织，插入的 organizationId 取自事务上下文；创建时同时写基础译文，失败一起回滚。完整业务筛选、分页、授权、审计与 HTTP 接口按 S4–S7 实施。

TenantTx 品牌阻止普通 db/Pool 作为 Repository 参数；`pnpm lint:boundaries` 约束 `src/repositories/` 只依赖 Schema、Drizzle 查询表达式和 TenantTx 类型，不能导入全局连接或事务工厂。新增租户 Repository 放在这个目录内。

迁移 `0002_projects.sql` 建立两张租户表、组织复合外键及译文唯一约束；`0003_tenant-rls.sql` 对两表 ENABLE/FORCE RLS，按 UUID 上下文设置 USING/WITH CHECK，仅授权 app_runtime CRUD。platform_runtime 没有业务表权限。

根目录 `pnpm verify` 检查边界、类型、lint、Schema 漂移与完整数据库测试；`pnpm test:isolation` 单独复现隔离测试。

## S5 语言字段与列表

迁移 0006/0007 增加 user.preferred_locale（可空）与 organization.default_locale（默认 zh-CN），并限制支持语言。app_runtime 获得 default_locale 列的 UPDATE 权限。迁移仍只由 one-shot migrator 执行。

`projectRepository.listPage(tx, query)` 在 TenantTx 内按请求 locale 解析整条译文，执行分页、筛选与稳定排序，同时返回 total。基础译文缺失视为数据完整性错误。详见 [S5 实施与验证记录](../../docs/architecture/s5-validation.md)。

## Projects 创建审计

迁移 0008/0009 建立 `audit_events` 及 ENABLE/FORCE RLS，只授予 `app_runtime` SELECT/INSERT。审计 Repository 接收 `TenantTx`，actorId、organizationId 和 requestId 来自可信事务上下文；资源 ID 和身份 ID 作为历史事实保存，不引用会级联删除的业务外键。

正式创建接口将 Project、基础译文与 `project.created` 放入同一事务，审计写入失败全部回滚。未显式指定 contentLocale 时，在事务内读取组织 defaultLocale，不使用请求界面语言。
