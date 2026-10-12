# 本地 Compose 发行与安全回退

发行包含 PostgreSQL、Redis、Mailpit、one-shot Migrator、API、独立 Worker、租户/平台 SPA、OTel Collector、Prometheus 与 Jaeger。Files 默认启用 Local 专属持久卷，也支持已有私有 S3 bucket 的显式配置。租户与平台保留各自的登录及业务路由。

## 构建与发布

从源码根目录执行。使用锁定 Node/pnpm、冻结依赖和不可变基础镜像；生产 API/Worker 使用隔离的生产依赖包，以 node 用户运行，SPA 以 nginx 用户运行。环境文件不进入构建上下文。

```sh
docker build -f infra/release/Dockerfile --target api --build-arg RELEASE_REVISION='<来源>' -t enterprise-admin-api:candidate .
docker build -f infra/release/Dockerfile --target worker --build-arg RELEASE_REVISION='<来源>' -t enterprise-admin-worker:candidate .
docker build -f infra/release/Dockerfile --target tenant --build-arg RELEASE_REVISION='<来源>' -t enterprise-admin-tenant:candidate .
docker build -f infra/release/Dockerfile --target platform --build-arg RELEASE_REVISION='<来源>' -t enterprise-admin-platform:candidate .
docker build -f infra/release/Dockerfile --target migrator --build-arg RELEASE_REVISION='<来源>' -t enterprise-admin-migrator:candidate .
```

复制 `infra/release/.env.example` 到私有环境文件，填写随机数据库密码、认证密钥、邮件加密密钥与五个实际 image ID。迁移 URL 密码须对应 migrator 角色，URL 特殊字符需编码。GitHub OAuth、外部邮件和 S3 连接由部署方提供；Mailpit 用于本地邮件验收。

同一安装的升级和回退继续使用同一份数据库、认证及加密配置。空卷 bootstrap 创建角色，已有数据库不重设密码。CLI、Migrator、API 与 Worker 分别得到其运行所需凭据。

```sh
node infra/release/publish.mjs enterprise-admin-local-release /private/path/release.env
```

发布持有该主机对应 Compose project 的排他锁。先检查旧/目标 Worker 的任务目录，完成基础服务固定配方构建，再启动基础设施，执行正式迁移链与 Files 卷初始化，依次等待 API、当前启动 Worker 的 `worker_ready`、双 SPA，最后核对两入口的登录页、Session 和 API 错误代理。固定配方构建失败时尚未进行数据操作；迁移失败不会替换已有应用容器；Worker 不就绪不会发布 SPA。不可变离线发行包已经绑定并加载验收后的基础镜像，不再次在线构建。

## 回退边界

回退替换已接受版本的 API、Worker 和双 SPA image ID，保留当前 Migrator、持久卷、认证密钥和邮件加密密钥，再经过相同发布入口。数据库只向前迁移。组织停用、成员移除和平台撤权是当前事实，旧镜像仍必须拒绝相应旧会话。

目标 Worker 必须支持当前已注册的每个任务类型；缺少类型时发布在迁移和替换容器之前停止。任务失败和未知类型不会执行旧处理器。历史 Worker 的真实源码、Dockerfile 与实际 image ID 参与回退断言，重新打 tag 不构成版本回退。

回退验收限定具体提交及镜像。`7fd7b5e` 的基础 Worker 目录为空，只能作为基础运行时的历史证据；它不能作为新增业务任务的完整安全回退目标。新增任务的可回退基线须先具备完整处理器并通过当轮正式验收。

## 可复现验收

```sh
RELEASE_ROLLBACK_REF=<已接受的真实提交> pnpm test:release
```

独立串行 release project 使用随机 project、端口、密码和专属数据卷；构建前先冻结不含 ignored 凭据/依赖的源码 tar，再从该快照构建候选镜像，历史镜像从明确 Git 提交及其 Dockerfile 构建。测试覆盖：

- 真实 SQL 迁移失败阻断首装，升级失败保留原容器及 ledger。
- 正式注册、邮件验证、登录、邀请、平台 CLI 任职、TOTP 与代理路由。
- 候选发布、停用/移除/撤权、实际旧镜像回退，以及同一旧 Cookie 的安全拒绝。
- Local 文件上传、发布、升级、回退及恢复后真实字节保留。
- 停写备份 PostgreSQL、Redis、Local Files；新专属卷恢复业务事实、旧 session 与原文件字节。
- S3 私有对象停写备份到新空 prefix，正式 HTTP 下载原字节。
- Worker 任务目录阻断、独立进程、真实 Redis 持久状态、正式遥测传输与本地告警规则。

证据在系统临时目录 `enterprise-admin-release-*`；完整验收和资源清理成功后 `result.json` 才标为 accepted。只清理该轮资源，不执行全局 Docker 清理。备份目录含私有数据，按 [备份恢复指南](backup-restore.md)保存；用于发行的源码包不包含备份或凭据。

不可变产物扫描及 SBOM 见 [发行包](release-package.md)，安装/升级见 [升级指南](upgrade.md)，观测端口及规则见 [观测指南](observability.md)。本轮交付与证据为本机回环 HTTP/Compose；真实服务器、TLS、外部 OAuth/邮件和外部告警投递仍需对应环境的实际验收。
