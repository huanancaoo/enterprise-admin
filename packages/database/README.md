# Database（S2–S3）

`@workspace/database` 仅供服务端使用。认证配置采用 [Better Auth Drizzle 生成链](https://better-auth.com/docs/adapters/drizzle)，认证 Schema 不手改。部署只执行本包的 `migrations`。

## 本地 PostgreSQL

1. 将 `infra/postgres/.env.example` 复制为 `infra/postgres/.env`，填写五个独立密码。仅在首次初始化空数据卷时使用它们；修改文件不会改变已有角色密码。
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

## 平台任职与 MFA

先让目标用户通过正常认证完成注册和邮箱验证，再使用部署 CLI 以精确用户 UUID 授予平台角色。CLI 不创建用户、改邮箱验证状态或提供 HTTP 授予接口；`platform_admin` 与 `platform_auditor` 只存于独立 `platform_assignment`。每次 grant/revoke 都把操作者、角色变化、原因和结果写入内部 `platform_assignment_audit`，写入与任职变更使用同一事务。

```sh
PLATFORM_ASSIGNMENT_DATABASE_URL='postgresql://platform_deployer:...@db/enterprise_admin' \
  node apps/api/dist/console.js platform assignment grant \
  --user-id '<verified-user-uuid>' --role platform_admin --reason 'ticket reference'
PLATFORM_ASSIGNMENT_DATABASE_URL='postgresql://platform_deployer:...@db/enterprise_admin' \
  node apps/api/dist/console.js platform assignment revoke \
  --user-id '<verified-user-uuid>' --role platform_admin --reason 'assignment ended'
```

API 的认证、租户与平台模块统一使用 `DATABASE_URL` 对应的 `app_runtime` 连接池。迁移 `0024_shared-runtime-platform-access.sql` 将 `read_platform_access(user_id, session_id)` 与 `record_platform_access_denial(actor_id, reason, request_id)` 的执行权限授予 `app_runtime`，并撤销 `platform_runtime` 的相应权限；`app_runtime` 仍不能直接读写 `platform_assignment`。平台认证插件仅在 Better Auth 报告成功的当前 Session TOTP 验证后登记 session assurance。平台身份每次请求都校验当前、未过期 Session、有效任职和 MFA assurance；写操作要求 assurance 时间在 15 分钟内。MFA 启用标记、Membership、账户 metadata 和浏览器状态都不能替代当前 Session 的 TOTP 事实。

### 已有数据库升级

全新数据卷由 `bootstrap.sql` 创建 `platform_deployer` 与 `platform_executor`。已有数据库必须在执行新增 migration 前，以 DBA/bootstrap 连接运行角色升级脚本；bootstrap 不会作用于已有数据卷。将 PostgreSQL 角色密码通过环境注入 psql，使用与应用相同的目标数据库：

```sh
env PLATFORM_RUNTIME_PASSWORD='...' PLATFORM_DEPLOYER_PASSWORD='...' \
  psql "$DBA_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/postgres/upgrade-platform-roles.sql
MIGRATION_DATABASE_URL='postgresql://app_migrator:...@db/enterprise_admin' pnpm db:migrate
```

`PLATFORM_RUNTIME_PASSWORD` 设置 API 使用的独立平台连接密码；`PLATFORM_ASSIGNMENT_DATABASE_URL` 只注入部署授权命令。迁移 0022 保留旧平台任职并记录迁移来源；旧记录未保存原角色、操作者和原因，因此按 `platform_admin` 迁移并明确标记其历史信息缺失。`app_migrator` 不能创建数据库角色；角色升级脚本必须成功后才能运行迁移。

## 角色和访问范围

| 角色                | 权限                                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bootstrap_admin`   | PostgreSQL 初始化/运维角色；不注入应用或迁移进程                                                                       |
| `app_migrator`      | 非超级用户，持有应用表与迁移 ledger；仅作为迁移时可切换的 `platform_executor` 成员；无创建数据库/角色或 BYPASSRLS 权限 |
| `app_runtime`       | Better Auth、邮件、租户 Projects 与审计所需权限；平台身份、MFA 和拒绝审计通过固定函数处理，无平台任职表直接读写权限    |
| `platform_runtime`  | 历史迁移使用的角色；0024 后不再具有平台固定函数执行权限，API 不使用该账号                                              |
| `platform_deployer` | 登录用户、查询目标邮箱验证状态、grant/revoke 平台任职并追加内部审计；没有 DDL 或其他应用表权限                         |
| `platform_executor` | `NOLOGIN` 函数所有者；只获得固定平台函数读取所需列权限，不是运行时账号                                                 |

组织运营状态的唯一来源是 `organization_status`（ACTIVE/SUSPENDED 及授权版本）。新组织由 INSERT 触发器初始化为 ACTIVE；缺失状态拒绝访问。`app_runtime` 可读状态与授权版本、可更新 `authorization_version`，不能改 `status`；`platform_runtime` 不能读写该表。平台停用/恢复 HTTP 仍属于后续任务；测试用 migrator 夹具布置状态。

服务端通过 `createDatabase(runtimeUrl)` 获取 `pool` 和类型化 `db`，调用者在退出时执行 `pool.end()`。包不会自动连接或读取迁移变量。`createAuth` 需要注入 `SecondaryStorage` 与 `trustedProxies`；HTTP 运行时由 API 从 `REDIS_URL` 与 `BETTER_AUTH_TRUSTED_PROXIES` 接入。

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

## 平台访问拒绝审计

迁移 `0023_platform-access-denial-audit.sql` 允许无组织归属的审计事实，并新增固定函数 `record_platform_access_denial(uuid, text, text)`。迁移 0024 后只有 API 使用的 `app_runtime` 可调用；函数由受限 NOLOGIN `platform_executor` 执行，仅追加私有的 `platform.access_denied` 事件。`app_runtime` 不能通过该函数读取审计或写入任意事件；部署身份与历史 `platform_runtime` 无调用权限。

`PlatformGuard` 在身份、任职或会话 MFA 校验拒绝时独立写入事件，保存可信 actor、稳定拒绝分类和服务端 requestId；匿名请求的 actorId 为空。事件不关联组织，租户 RLS 不可见，不保存 Cookie、令牌或认证秘密。审计写入失败返回 `503 AUDIT_UNAVAILABLE`，由现有错误日志记录 requestId。
