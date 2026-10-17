# Database（S2–S3）

`@workspace/database` 仅供服务端使用。认证配置采用 [Better Auth Drizzle 生成链](https://better-auth.com/docs/adapters/drizzle)，认证 Schema 不手改。部署只执行本包的 `migrations`。

## 本地 PostgreSQL

1. 将 `infra/postgres/.env.example` 复制为 `infra/postgres/.env`，填写五个独立密码。仅在首次初始化空数据卷时使用它们；修改文件不会改变已有角色密码。
2. 启动数据库：

   ```sh
   docker compose --env-file infra/postgres/.env up -d postgres
   ```

数据库固定为 PostgreSQL 18.6，镜像摘要与 `docs/architecture/versions.json` 一致。端口只绑定本机，默认 5432；冲突时调整 `POSTGRES_PORT`。命名卷挂载 PostgreSQL 18 的 `/var/lib/postgresql`，普通 `docker compose down` 保留数据。

上述开发 Compose 保留既有 Bookworm 配置与本地卷。自托管发行和业务/数据库验收使用 `versions.json` 的 `releaseFoundation` 固定 Alpine 镜像，先执行 `pnpm release:prepare`；独立根测试入口已包含该准备步骤。既有自托管 Bookworm 数据须按[基础发行迁移](../../docs/guides/backup-restore.md#bookworm-到-alpine-的基础发行迁移)停写、逻辑恢复新卷并重建索引，不直接挂载给新发行。

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

把授权 SQL 写入生成的文件，与结构迁移一起审查。已执行的 migration 不修改；新变更使用新文件。按提交顺序发布迁移；one-shot 在同一个连接持有数据库 advisory lock，使误启动的第二个 Migrator 等待首个进程结束，再重新读取 ledger，避免重复执行 SQL。

### 本机 one-shot 进程

从 `packages/database/.env.example` 创建专用 `.env`，填入迁移 URL（密码中的特殊字符必须 URL 编码）。本机地址使用 localhost 和实际端口。仅将该环境注入迁移进程：

```sh
cd packages/database
node --env-file=.env src/migrate.ts
```

若执行环境已注入 `MIGRATION_DATABASE_URL`，可在根目录运行 `pnpm db:migrate`。脚本要求真实连接身份为 `app_migrator`，成功退出 0，缺配置、错误身份或迁移失败均非零退出。Drizzle ledger 位于 `drizzle.__drizzle_migrations`，重复执行不重放已记录的迁移。待执行 SQL 和 ledger 记录在事务中提交；失败回滚。迁移 SQL 必须能够在事务中执行。

S7 首次升级至 S8 组织约束前，迁移入口检查无 owner 的组织、重复成员关系与同组织重复角色。异常会显式阻止升级，保留原数据与 ledger；部署者须按业务事实修正旧数据后重新执行，不会自动授予 owner 或合并重复记录。

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

部署 CLI 的 `platform admin create --email <email> --name <name> --reason <reason> --password-stdin` 可直接创建 `platform_admin`。密码通过标准输入传入，使用 Better Auth 原生哈希与统一的 12–128 字符规则；邮箱转小写并默认已验证，不发送验证邮件。账号、credential、平台任职及授权审计在一个事务内提交；邮箱重复或任一步骤失败均回滚，不修改已有账号。命令仅依赖 `PLATFORM_ASSIGNMENT_DATABASE_URL` 指向的 `platform_deployer`，不依赖运行中的 API、Redis 或 SMTP。

已有用户通过正常认证完成注册和邮箱验证后，仍使用 `platform assignment grant/revoke` 以精确 UUID 管理任职；它们不创建账号或修改邮箱验证状态。平台任职保存在独立 `platform_assignment`，角色存于 `platform_role`，多角色关联存于 `platform_assignment_role`。grant/revoke 分别添加或撤销指定角色；最后角色撤销时终止任职。每次 grant/revoke 都把操作者、角色变化、原因和结果写入内部 `platform_assignment_audit`，写入与任职变更使用同一事务。创建账号不初始化 MFA 或登录会话；MFA 由用户自主启用，未启用者密码登录后即可进入平台。

```sh
PLATFORM_ASSIGNMENT_DATABASE_URL='postgresql://platform_deployer:...@db/enterprise_admin' \
  node apps/api/dist/console.js platform assignment grant \
  --user-id '<verified-user-uuid>' --role platform_admin --reason 'ticket reference'
PLATFORM_ASSIGNMENT_DATABASE_URL='postgresql://platform_deployer:...@db/enterprise_admin' \
  node apps/api/dist/console.js platform assignment revoke \
  --user-id '<verified-user-uuid>' --role platform_admin --reason 'assignment ended'
```

API 的认证、租户与平台模块统一使用 `DATABASE_URL` 对应的 `app_runtime` 连接池。迁移 `0024_shared-runtime-platform-access.sql` 将 `read_platform_access(user_id, session_id)` 与 `record_platform_access_denial(actor_id, reason, request_id)` 的执行权限授予 `app_runtime`，并撤销 `platform_runtime` 的相应权限；`app_runtime` 仍不能直接读写 `platform_assignment`。平台认证插件仅在 Better Auth 报告成功的当前 Session TOTP 验证后登记 session assurance。迁移 `0060_optional-platform-mfa.sql` 将平台 MFA 改为可选；平台每次请求校验当前未过期 Session 与有效任职，读写通过 `require_platform_action` 校验具体代码动作，只有内置超级管理员可管理任职和角色授权。真实 TOTP 验证仍登记 assurance 作为验证事实，但不作为平台准入或操作的必要条件。自主启用两步验证后的登录由 Better Auth 执行。

### 多角色授权与密码登录锁

迁移 `0070` 将旧平台角色迁移至 `platform_role` / `platform_assignment_role`，移除任职表的单角色列；`0071` 将所有平台固定函数替换为具体动作授权。代码目录为 `packages/permissions/src/platform.ts`，数据库纯目录函数为 `platform_permission_catalog()`。受限函数每次读取有效 Session、全局账号、任职和多角色权限并集，runtime 无角色表直接访问权。

内置超级管理员不可删除、停用或修改权限，自定义角色不接受 `platform.authorization:manage`。任职及角色写入先调用 `lock_platform_authorization()`（事务锁 `20261017,1`），提交时由延迟约束保护最后一位有效超级管理员；全局账号暂停也受该约束。任职停用或撤销自动清除角色，恢复不会恢复角色。

迁移 `0075_platform-export-actions` 将既有组织、全局账号、登录日志、会话与操作日志的列表投影复用为受限内部函数。`list_*` 固定入口要求 `read`，`export_*_page` 固定入口只要求对应 `export`；内部投影函数不向 runtime 开放，导出不隐含额外读取权限。

`password_login_lock` 按全局账号保存滚动失败时间和锁定截止时间。原生密码 verifier 在单连接事务中调用 `begin_password_login` / `finish_password_login`，同账号并发验密串行；滚动15分钟内第五次失败锁15分钟，正确密码先清零再继续原生邮箱/MFA流程。既有Session、GitHub和原生MFA锁不受影响。`POST /api/v1/platform/users/:userId/password-login/unlock` 要求 `platform.user:unlock` 并同事务记录解锁审计，不重置密码。

迁移 `0077_platform-login-lock-projection` 让平台登录记录以当前账号关联有效 `lockedUntil`，匿名、无锁或已过期均为 `null`。平台使用独立 `PlatformLoginLog` / `PlatformLoginLogsPage` 契约，个人登录记录保持原契约；锁状态不写入历史表，解锁或到期后下一次查询立即反映。

### 已有数据库升级

全新数据卷由 `bootstrap.sql` 创建 `platform_deployer` 与 `platform_executor`。已有数据库必须在执行新增 migration 前，以 DBA/bootstrap 连接运行角色升级脚本；bootstrap 不会作用于已有数据卷。将 PostgreSQL 角色密码通过环境注入 psql，使用与应用相同的目标数据库：

```sh
env PLATFORM_RUNTIME_PASSWORD='...' PLATFORM_DEPLOYER_PASSWORD='...' \
  psql "$DBA_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/postgres/upgrade-platform-roles.sql
MIGRATION_DATABASE_URL='postgresql://app_migrator:...@db/enterprise_admin' pnpm db:migrate
```

`PLATFORM_RUNTIME_PASSWORD` 仅供上述 DBA 角色升级脚本配置历史 `platform_runtime` 角色，API 不使用该身份；`PLATFORM_DEPLOYER_PASSWORD` 配置部署 CLI 使用的 `platform_deployer` 角色密码。`PLATFORM_ASSIGNMENT_DATABASE_URL` 只注入部署授权命令，在线 API 使用 `DATABASE_URL`。迁移 0022 保留旧平台任职并记录迁移来源；旧记录未保存原角色、操作者和原因，因此按 `platform_admin` 迁移并明确标记其历史信息缺失。`app_migrator` 不能创建数据库角色；角色升级脚本必须成功后才能运行迁移。

## 角色和访问范围

| 角色                | 权限                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap_admin`   | PostgreSQL 初始化/运维角色；不注入应用或迁移进程                                                                                |
| `app_migrator`      | 非超级用户，持有应用表与迁移 ledger；仅作为迁移时可切换的 `platform_executor` 成员；无创建数据库/角色或 BYPASSRLS 权限          |
| `app_runtime`       | Better Auth、邮件、租户 Projects 与审计所需权限；平台身份、MFA 和拒绝审计通过固定函数处理，无平台任职表直接读写权限             |
| `platform_runtime`  | 历史迁移使用的角色；0024 后不再具有平台固定函数执行权限，API 不使用该账号                                                       |
| `platform_deployer` | 创建原生密码账号、查询目标邮箱验证状态、grant/revoke 平台任职并追加内部审计；不能读取密码、修改已有账号、访问租户业务或执行 DDL |
| `platform_executor` | `NOLOGIN` 函数所有者；只获得固定平台函数所需的列级读写权限，不是运行时账号                                                      |

组织运营状态的唯一来源是 `organization_status`（ACTIVE/SUSPENDED 及授权版本）。新组织由 INSERT 触发器初始化为 ACTIVE；缺失状态拒绝访问。`app_runtime` 可读状态与授权版本、可更新 `authorization_version`，不能直接改 `status`；`platform_runtime` 不能读写该表。

迁移 `0028`–`0030` 提供组织运营查询与启停固定函数，API 通过 `/api/v1/platform/organizations` 调用。查询只投影组织元数据、成员角色计数与启停历史，不返回成员身份字段或 Projects。固定函数由受限 `platform_executor` 执行，设置固定 search_path、启用 row_security 并撤销 PUBLIC 执行权限；`app_runtime` 仅有函数调用权限，不能直接读写 `operation_receipts`。

停用和恢复要求当前有效会话的平台管理员、理由、预期状态版本及幂等键。函数与租户写入锁定同一组织状态行，在同一事务提交状态、成功审计与 24 小时幂等收据；等锁后再次查权，旧收据不能绕过撤权。目标状态未变时记录私有的 `no_change` 尝试，不增加状态版本或重复生成启停事件。运营读取先写成功审计才返回投影；查询和启停失败的审计独立提交，审计不可用时返回失败。恢复只改变运营状态，不延长邀请或重建已移除的成员和平台任职。

迁移 `0031_platform-user-queries.sql` 建立用户目录、详情与显式敏感邮箱读取，`0069` 在目录与详情中增加全局账号状态和版本。目录按创建时间和用户 ID 稳定分页，只检索姓名、用户 ID 和脱敏邮箱；列表与详情对管理员、审计员一律返回脱敏邮箱。详情包含组织关联、邮箱验证、双重验证及账号状态，不返回认证秘密或业务数据。`platform_executor` 只获得必要的身份列权限，不能读取密码、Session token、2FA secret 或恢复码。

完整邮箱由独立 `get_platform_sensitive_profile` 固定函数读取，要求当前有效会话的平台管理员，每次携带非空目的。固定函数先提交一次私有敏感读取审计，再返回邮箱；审计失败返回 `AUDIT_UNAVAILABLE`。访问审计只存操作者、目标用户 ID 和输入目的，不存完整邮箱快照。API 响应禁止缓存；前端完整邮箱只保存在本次展开的组件状态中，关闭后销毁，不进入目录 Query Cache。

### 全局账号管理与会话

迁移 [0068_flippant_magma.sql](migrations/0068_flippant_magma.sql) 建立 `user_account_status` 和 `login_events`；[0069_identity-management-access.sql](migrations/0069_identity-management-access.sql) 初始化旧账号状态，并提供触发器、固定函数、RLS 和显式授权。`user_account_status` 是全局账号状态的唯一来源，取值为 `active` / `suspended`。旧账号和新账号都初始化为 `active`、版本 1；新账号由 `user` INSERT 触发器初始化，缺失状态时拒绝授权，返回 `AUTHORIZATION_UNAVAILABLE`。

| 能力                                     | 当前有效会话的平台管理员 | 当前有效会话的平台审计员 |
| ---------------------------------------- | ------------------------ | ------------------------ |
| 读取用户目录、详情、登录日志及未过期会话 | 允许                     | 允许                     |
| 创建普通账号、编辑姓名、暂停或恢复账号   | 允许                     | 拒绝                     |
| 请求密码重置、撤销单个会话               | 允许                     | 拒绝                     |

这些全局管理权限不由租户成员或角色授予。两张新表均启用并强制 RLS，`app_runtime` 不获得直接读写权限，通过受限 `platform_executor` 所有的固定函数访问；内部投影和审计辅助函数不对 runtime 开放。部署 CLI 与系统管理员工接口分别提供受控任职入口；普通全局账号创建不创建平台任职或组织成员关系。

用户管理通过 `POST /api/v1/platform/users` 创建账号，通过 `PATCH /api/v1/platform/users/:userId` 编辑姓名。管理员填写姓名、邮箱和 12–128 字符初始密码；API 使用 Better Auth 原生哈希，固定函数在同一事务创建账号、credential 与成功审计。邮箱转为小写并默认已验证，不发送验证邮件；重复邮箱返回 `EMAIL_ALREADY_EXISTS`，不修改已有账号。编辑只允许改姓名；本批不提供修改他人邮箱或硬删除账号。

姓名和状态变更必须提交 `expectedVersion`，不匹配返回 `VERSION_CONFLICT`。原生用户改名也由触发器递增同一版本；平台改名遵循原生写入的 user 行再到状态行的锁顺序。实际值未变时记录 `no_change`，不增加版本。

暂停通过 `/api/v1/platform/users/:userId/status` 修改全局状态并删除该账号全部数据库会话；API 在持有状态锁的同一事务内完成原生会话缓存清理和成功审计，再提交。授权检查读取并锁定账号状态，原生 session INSERT 触发器也在实际写入事务内验证状态，防止暂停后又插入会话；续期与暂停删除在原会话行上串行，不重建被删会话。平台与租户身份、该用户的 API 凭据及任务成员授权均检查全局状态，组织正常运行不能绕过账号暂停。暂停不移除平台任职、租户成员或角色；恢复只把状态改回 `active`，旧会话不恢复，用户须重新登录。

`/api/v1/platform/sessions` 只列出未过期会话，使用 `page/pageSize` 分页，可按姓名、脱敏邮箱、用户 ID 或 IP 筛选。响应仅含 Session ID、用户摘要、创建/更新时间、到期时间、IP 和 User-Agent，不含 token。管理员通过 `DELETE /api/v1/platform/sessions/:sessionId` 撤销指定会话；数据库删除与成功审计同事务提交，原生缓存清理在提交前执行，清理失败回滚数据库事务。目标已不存在时返回 `revoked: false` 并记录 `no_change`。API 仅在服务端使用 token 清理原生缓存；认证会话以数据库中的有效记录为准，Redis 不替代数据库存续检查。

密码重置通过 `POST /api/v1/platform/users/:userId/password-reset` 发起，仅接受处于 `active` 状态的全局账号。准备函数先验证管理员权限，再把完整邮箱交给服务端原生重置流程，HTTP 不返回邮箱或令牌。数据库重置令牌、加密邮件入队记录及 `platform.user_password_reset_requested` 成功审计使用同一 client 事务提交；失败共同回滚，失败审计另行写入。`{ requested: true }` 表示重置请求已提交，SMTP 投递由邮件 Worker 执行，不代表已投递成功；请求本身不撤销现有会话，用户完成原生密码重置后才撤销该账号会话。

创建、改名、暂停、恢复、密码重置请求及会话撤销写入各自的 `platform.*` 操作事实；管理服务的失败尝试通过固定函数独立记录稳定错误码，审计不可用返回 `AUDIT_UNAVAILABLE`。`0069` 将这些事件和会话、登录日志查询事实加入批准的目录，平台操作日志列表和详情均可读取；不公开原始错误消息、密码、完整邮箱或 token。

### 登录日志与本人范围

`login_events` 保存登录时间、用户 ID 与姓名快照、脱敏邮箱、方式、结果、稳定失败原因、IP 和 User-Agent。方式为 `email` / `github` / `totp`，备份码验证归入 `totp`；成功结果的失败原因为空。失败原因限定为 `INVALID_CREDENTIALS`、`EMAIL_NOT_VERIFIED`、`INVALID_OTP`、`ACCOUNT_SUSPENDED`、`AUTHORIZATION_UNAVAILABLE` 或 `AUTHENTICATION_FAILED`，不保存认证实现的任意错误消息。邮箱登录失败按输入邮箱精确关联现有账号，未知邮箱的用户 ID 为空；原始输入邮箱仅用于关联和脱敏，不写入日志。

登录事实按 Better Auth 完整认证流程的最终结果记录；两步验证尚未完成时不记录成功登录。成功日志写入失败会撤销新会话并返回 `AUDIT_UNAVAILABLE`；失败认证的日志写入故障只记录不含认证秘密的运行故障事件。日志表不保存密码、OTP、Cookie、Session token 或 2FA secret。

`GET /api/v1/platform/login-events` 允许平台管理员与审计员分页查看全局登录记录，可按姓名、脱敏邮箱、用户 ID、方式、结果及起止时间筛选。`GET /api/v1/me/login-events` 只返回当前有效会话本人的记录：HTTP Schema 不接受 `userId` 或 `q`，固定函数也始终使用可信 actor ID 筛选，不能读取他人记录。两者均返回 `items/page/pageSize/total`，默认每页 20 条、最多 100 条，时间筛选可选且起点不得晚于终点；不沿用操作日志的默认 30 天与最长 90 天窗口。

平台读取追加 `platform.login_logs_queried`，本人读取追加 scope 为 `user` 的 `user.login_logs_queried`，均在审计写入成功后返回结果。本人读取事实不属于租户操作日志或平台操作日志的批准事件目录；登录记录和公开响应都只保存或返回脱敏邮箱。

### 租户操作日志

租户通过 `audit:read` 权限查看当前组织的操作日志。列表使用 `page/pageSize`，返回 `items/page/pageSize/total/window`；总数与当前页在同一 SQL 语句中计算，越界页保留真实总数。默认最近 30 天、最长 90 天且拒绝未来时间，后续翻页沿用返回的时间窗口及微秒精度。查询始终经 TenantTx 和现有 RLS，只公开租户可见事实与获准的平台摘要；操作者、资源筛选不会探测平台内部字段。

### 平台跨组织审计

迁移 `0033`–`0035` 为获准运营审计增加全局时间索引、固定 list/get 函数和最小列权限。管理员、审计员均需当前有效任职与 Session；固定函数成功写入一次私有访问审计后才返回，审计故障不返回受限结果。

查询范围固定为批准目录中的组织管理与平台运营事件，以及部署 CLI 原有任职审计。带来源的事件 ID 保留两类历史事实身份；响应不含完整邮箱、内部理由、部署操作者字符串或原始 metadata。`platform_audit_projection` 为受限 executor 的 security_invoker 视图，运行角色不能直接读取；新增策略不放宽 Projects 或租户运行角色 RLS。

默认最近 30 天、最多 90 天及未来时间拒绝由数据库同一时钟决定；API 只传递筛选及页码，不用主机时差改变业务窗口。响应返回数据库解析的 `window.from/to`，前端后续翻页沿用此窗口。验收记录见 [S8 平台审计验证](../../docs/architecture/s8-platform-audit-validation.md)。

迁移 `0037_platform-audit-pagination.sql` 将列表改为各来源先按已有时间/UUID 索引选取至多一页候选，再合并分页、关联组织及用户、生成脱敏 JSON，避免先投影整个 90 天窗口。公开 ID、时间边界、筛选、游标次序和字段保持一致，仍先验证当前任职与有效会话，并在返回前提交私有访问审计；角色权限与 RLS 不变。固定规模 HTTP 性能证据见 [S8 发布验收记录](../../docs/architecture/s8-release-validation.md)。

迁移 `0061` 将平台审计替换为 `page/pageSize` 页码查询，返回 `items/page/pageSize/total/window`，移除原游标函数签名。总数与当前页在同一 SQL 语句快照内计算；两个来源过滤后分别取候选，再按时间和完整事件 ID 合并分页，只有当前页关联身份并投影。超出末页返回空 `items` 与真实 `total`，每次读取仍重新验证任职与 Session，并在返回前追加私有读取审计。`0062`–`0063` 为这条读取事实显式记录查询完成时刻并授予 executor 最小列权限，避免事务开始时间使它落入本次已冻结窗口。

`0064` 将获准事件目录集中到仅供 executor 使用的不可变函数，列表及 RLS 使用固定 scope 求得常量目录后匹配事件；原分类函数、列表、目录函数仍固定 `search_path=pg_catalog`。此调整消除精确计数时逐行调用 SQL 函数的开销，不改变目录内容或运行角色权限。

`0066` 将审计列表和详情的读取目的改为可选备注，最多 500 字符。缺省或空白在私有访问事实的 `reason` 中保存为 NULL；填写时保存去除首尾空白的内容。页面进入后直接加载，筛选在 DataTable 工具栏中展开；任职、Session、范围校验及访问审计写入成功后才返回的规则保持不变。

`0067` 完全移除操作日志 list/get 的读取目的参数并删除旧函数签名；新函数维持原 executor 所有权、授权与安全配置。访问事实的 `reason` 固定为 NULL，操作者、范围和详情访问仍记录，写入失败仍不返回结果。此规则取代 `0066` 的可选备注；用户完整邮箱读取目的保留。

### 平台默认语言与部署摘要

迁移 `0036_platform-settings.sql` 建立必有的 `platform_settings` 单例，初始默认语言为 `zh-CN`。`app_runtime` 仅能直接读取单例键与默认语言，不能直接读版本或写入设置；受限 executor 持有固定 get/update 函数。设置查询需有效平台任职和当前会话，并先追加私有读取审计；修改仅允许管理员，要求当前有效会话、操作原因、预期版本和幂等键。默认语言、版本、私有审计与 24 小时收据在同一事务提交，锁等待后重新查权；相同输入重试返回原结果，版本冲突或同键不同输入拒绝，无实际变化时不增加版本。

语言解析从同一个持久化默认值读取：原生认证、业务 HTTP、Projects 创建基础语言及邮件收件人继承均使用它。修改不批量改写用户或组织偏好，也不强制改变当前 UI 语言。邮件不再使用独立的 `EMAIL_DEFAULT_LOCALE` 环境变量；已经渲染入队的邮件保留当时内容。API 只额外返回支持语言、环境、应用版本与 SMTP 是否配置，不能返回 SMTP 地址、口令或连接串。SMTP 配置状态不代表投递可用性。验收记录见 [S8 平台设置验证](../../docs/architecture/s8-platform-settings-validation.md)。

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

`PlatformGuard` 在身份或任职校验拒绝时独立写入事件，保存可信 actor、稳定拒绝分类和服务端 requestId；匿名请求的 actorId 为空。事件不关联组织，租户 RLS 不可见，不保存 Cookie、令牌或认证秘密。审计写入失败返回 `503 AUDIT_UNAVAILABLE`，由现有错误日志记录 requestId。
