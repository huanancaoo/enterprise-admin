# Database（S2）

`@workspace/database` 仅供服务端使用。认证配置采用 [Better Auth Drizzle 生成链](https://better-auth.com/docs/adapters/drizzle)，版本沿用 S0；认证 Schema 不手改。`tools/s0/migrations` 只用于独立兼容性探针，部署只执行本包的 `migrations`。

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

新增表时必须审查所属身份域、租户业务域或平台域，并在同一发布的 migration 中加入明确表名、角色和必要操作的 GRANT。不要使用 `ON ALL TABLES` 或默认自动授权；新增表默认没有 runtime 权限。UUID 主键不需要序列授权；将来若使用序列，按具体序列授予必要权限。业务表的 RLS / TenantTx 属于 S3，不把组织隔离策略复制到登录前需要访问的认证表。

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

## 角色和访问范围

| 角色               | 权限                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `bootstrap_admin`  | PostgreSQL 镜像初始化角色，拥有数据库；只用于首次初始化/运维                                              |
| `app_migrator`     | 非超级用户，可建 schema、持有应用表和迁移 ledger；无创建数据库/角色或 BYPASSRLS 权限                      |
| `app_runtime`      | 非 Owner；认证八表 SELECT/INSERT/UPDATE/DELETE；无 DDL、TEMP、TRUNCATE、迁移 ledger 或角色切换权限        |
| `platform_runtime` | 非 Owner；只读 user 公开身份列、organization 运营列和 member 关系列；无 account/session/verification 权限 |

平台授权、组织状态字段、平台设置和审计表尚未实现（S4/S8）。新增时按 ADR-0003 明确授权；平台数据库账号本身不等同于 HTTP 请求已经获得平台授权。

服务端通过 `createDatabase(runtimeUrl)` 获取 `pool` 和类型化 `db`，调用者在退出时执行 `pool.end()`。包不会自动连接或读取迁移变量。`createAuth(pool, baseURL, secret)` 提供与生成器相同的认证配置；真实 HTTP 接入和密钥注入在 S4 完成。

## 验收

```sh
pnpm verify:s2
```

先检查 Better Auth Schema 生成漂移，再在新的 Testcontainers PostgreSQL 中执行真实 bootstrap、两次 one-shot migration、Owner/权限断言、runtime 认证/组织操作、平台列权限、新表默认无授权、失败迁移回滚及非零退出。测试使用随机密码、随机映射端口，不读取开发数据库 URL；结束后销毁测试容器。

独立镜像与 Compose 持久化复现：`pnpm --filter @workspace/database test:compose`。它构建镜像，使用随机项目名与端口，验证容器删除重建后的数据保留及 migrator 非零退出，最终删除本次测试创建的容器、卷和镜像。
