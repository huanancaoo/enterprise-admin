# 本地 Compose 发布与安全回退

范围为 [#24](https://github.com/huanancaoo/enterprise-admin/issues/24) 的本地发布门禁：独立 PostgreSQL/Redis/Mailpit、one-shot Migrator、API 和两个 SPA。租户、平台分别监听回环端口，保留各自的 `/login`、`/app/*` 和 `/platform/*` 路由。邮件调度使用 API 内已有运行时，Files 在本轮显式设为 disabled。

## 构建与发布

所有命令从仓库根目录执行。镜像使用当前锁定的 Node/pnpm 和冻结依赖；API 仅安装生产依赖，以 node 用户运行，SPA 使用固定 Nginx 镜像且以 nginx 用户运行。镜像不复制环境文件。

```sh
docker build -f infra/release/Dockerfile --target api --build-arg RELEASE_REVISION='<源码提交>' -t enterprise-admin-api:candidate .
docker build -f infra/release/Dockerfile --target tenant --build-arg RELEASE_REVISION='<源码提交>' -t enterprise-admin-tenant:candidate .
docker build -f infra/release/Dockerfile --target platform --build-arg RELEASE_REVISION='<源码提交>' -t enterprise-admin-platform:candidate .
docker build -f infra/release/Dockerfile --target migrator --build-arg RELEASE_REVISION='<源码提交>' -t enterprise-admin-migrator:candidate .
docker image inspect --format '{{.Id}}' enterprise-admin-api:candidate enterprise-admin-tenant:candidate enterprise-admin-platform:candidate enterprise-admin-migrator:candidate
```

复制 `infra/release/.env.example` 为该目录的 `.env`，填入生成的随机密码、认证密钥、邮件加密密钥和上一步的四个不可变 image ID。数据库 URL 的迁移密码须与 `APP_MIGRATOR_PASSWORD` 相同；口令中的 URL 特殊字符需编码。GitHub OAuth 配置按 API 的现有要求填写；本轮验收填写测试配置，仅执行邮箱登录，不表示真实 GitHub 登录已验收。

同一安装的升级和回退继续使用同一份数据库、认证与加密配置；PostgreSQL bootstrap 只作用于空卷。API 的 Compose environment 只投影运行凭据，部署 CLI 和 Migrator 的凭据各自注入 one-shot 进程。

```sh
node infra/release/publish.mjs enterprise-admin-local-release infra/release/.env
```

入口依次等待基础服务、执行正式迁移链、等待 API 就绪、发布并等待双 SPA，最后核对两个入口的登录页、认证 Session 读取和 API 404 JSON 响应。迁移进程非零即停止，已有 API/SPA 容器不会被替换；API 就绪失败即停止 SPA 发布。`/api/*` 始终反代给 API，不进入 SPA 的页面路由处理；不存在的静态资源仍返回 404。

## 回退边界

回退使用已经通过下述真实状态验收的目标镜像 ID，替换 `.env` 中的三个应用镜像，保留当前 Migrator 镜像及全部持久配置，再执行同一个发布入口。数据库保持向前迁移，不执行 down migration、不恢复旧数据快照；组织停用、成员移除与平台撤权是现存业务事实。

允许回退的证据绑定具体源码提交和镜像 ID。旧版本必须在当前迁移链上继续拒绝停用组织及已撤权旧会话；任何未通过这些断言的历史版本都不得作为回退目标。该范围不包含重新启用一个忽略 S8 授权事实的旧 API。

## 可复现验收

```sh
RELEASE_ROLLBACK_REF=611fc74 pnpm test:release
```

`release` 是现有 Vitest 配置中的独立串行 project。必须显式指定上一已接受版本的 Git 提交；脚本从该提交的源码构建实际目标镜像，套用本轮发布 Dockerfile，不以重新打标签冒充回退。当前工作区构建候选镜像，最终检查实际运行容器的 image ID。

每轮使用随机 Compose project、端口、密码和专属数据卷，验证：

- 空库的真实待执行 SQL 失败后，API 和两个 SPA 均未启动。
- 已运行版本的迁移失败后，原三个应用容器和 ledger 保持原状，原业务读取仍可用。
- 注册、Mailpit 验证链接、登录、邀请接受、平台 CLI 任职与 TOTP 均通过正式入口。
- 候选发布后，正式停用组织、移除成员、撤销平台任职；镜像回退后同一旧 Cookie 仍被拒绝，数据库事实保持原状，其他启用组织的项目保留。
- 回退 SPA 深链接及刷新、登录、平台拒绝页面、登出后的 401，以及 API 错误与静态资源 404 的代理边界。

证据保存在系统临时目录下的 `enterprise-admin-release-*` 目录，包含构建日志、镜像 ID、最终结果和浏览器截图。失败时 Vitest 输出本轮目录，成功后的具体目录记入 [S8 发布验收记录](../architecture/s8-release-validation.md)。结束只删除本轮容器与数据卷、随机凭据文件和历史源码快照；镜像保留用于复核，不执行全局 Docker 清理。

这是本机明文 HTTP/回环网络验收。实际部署环境、TLS、备份恢复、S9 Files 发布及任意其他历史版本回退，仍各自需要对应验收证据。
