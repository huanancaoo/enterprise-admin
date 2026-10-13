# 维护停写备份与恢复

备份边界是同一安装的 PostgreSQL、Files 对象与 Redis 持久状态。API、Worker 和两个 SPA 在同一个维护窗口停止；认证邮件、Files 维护和队列执行也随所属进程停止。该窗口禁止直接向数据库、Redis 或对象命名空间写入。

## 备份

从发行源码目录执行，目标目录必须尚不存在：

```sh
node infra/release/backup.mjs <compose-project> <release.env> <new-backup-directory>
```

命令核对实际运行镜像、Files 配置与部署密钥是否匹配，停止入口与写入者，等待正常排空，再冻结 Redis。随后取得 PostgreSQL custom dump、完整 Redis 数据目录，以及 Local 私有目录或 S3 当前私有前缀下的对象、内容摘要和元数据。

`manifest.json` 最后写入；缺 manifest 的目录不作为完成的备份。当前格式为 v2，包含镜像 ID、文件 SHA-256、存储类型、PostgreSQL 版本/系统/排序元数据与排序样例、Redis 版本和认证/邮件加密密钥的指纹，未保存密钥原文。备份内容仍包含认证与业务数据，目录保持 0700、文件保持 0600，由部署方保管。迁移前用本版备份 CLI 重新取得完整 v2 快照。

成功后 API/Worker/SPA 与 Redis 保持停止；完成维护后使用正式发布入口重新启动：

```sh
node infra/release/publish.mjs <compose-project> <release.env>
```

发布、备份与恢复使用同一主机的项目排他锁。进程被外部强杀后，维护者核对该进程已结束，再移除其系统临时目录中的 `enterprise-admin-release-lock-<project>`；不要在快照执行中解除锁。

## 新安装恢复

准备新的 Compose project 和尚不存在的专属数据卷，按 manifest 填入原已验收镜像与部署方保管的原认证/邮件加密密钥。数据库登录口令可由新部署独立提供：空卷 bootstrap 创建角色，dump 恢复对象归属与授权，不恢复集群角色口令。S3 恢复使用明确的空目标私有前缀。

```sh
node infra/release/restore.mjs <new-compose-project> <release.env> <backup-directory>
```

校验和、密钥、镜像、存储类型或项目非空时，在恢复数据前拒绝执行。通过校验后恢复 PostgreSQL、Redis 和 Files，再执行正式 Migrator → API → Worker → SPA → smoke。不执行 down migration，也不把恢复当成忽略停用/撤权事实的版本回退。

## Bookworm 到 Alpine 的基础发行迁移

本次用户已明确接受新的 Alpine 自托管基线及目标排序迁移。PostgreSQL 保持 18.6，Redis 保持 7.4.5；源码固定官方摘要、原版 gosu 和同发行安全库。旧 Bookworm 数据卷保留为迁移来源，不直接挂载给 Alpine。

从旧发行的 `source` 目录，用本版脚本按旧项目、旧环境配置取得停写 v2 快照。脚本从当前目录定位旧 Compose：

```sh
cd <bookworm-release>/source
node <alpine-release>/source/infra/release/backup.mjs <old-project> <old-release.env> <new-backup-directory>
```

进入新发行源码目录，准备新 project、新卷和目标环境。应用、Worker、SPA、Migrator 镜像保持备份的实际 ID，认证/邮件密钥保持原值；数据库角色口令可由目标部署重新提供。目标基础镜像采用本版固定 Alpine 镜像：

```sh
cd <alpine-release>/source
node infra/release/migrate-foundation.mjs <new-project> <target-release.env> <bookworm-backup-directory>
```

迁移命令明确校验 PostgreSQL 18.6/Bookworm 来源和 PostgreSQL 18.6/Alpine、Redis 7.4.5/Alpine 目标，逻辑恢复到新卷并重建目标库全部索引，确认没有无效索引，再恢复 Redis 与 Files、通过正式发布 smoke。普通 `restore.mjs` 仍要求基础镜像与原排序元数据一致，不承担跨系统迁移。

目标默认排序为固定 Alpine/musl 的 `libc` provider、`en_US.utf8`、UTF8；样例顺序为 `Z, a, a-a, a_a, Å, ä, 北京`。默认排序样例、源/目标系统与镜像、索引检查写入 `foundation-migration.json`。框架 Projects 的公开排序仍为创建/更新时间，本次没有增加名称排序接口。

按下方正式 HTTP 验收事实核对迁移结果，保留源卷和快照。确认目标可用后才切换业务入口；如需恢复原部署，使用原 Bookworm 发行目录和原卷，不用 Alpine 发布入口重启来源项目。

## 验收事实

恢复后通过正式 HTTP/浏览器重新验证：原用户与会话、组织和项目、文件当前及固定版本字节、未完成操作、任务结果，以及停用组织、移除成员和平台撤权仍生效。恢复代表备份时刻的事实；备份之后的操作不在该快照内。

```sh
RELEASE_ROLLBACK_REF=<已接受的真实提交> pnpm test:release
```

测试在专属项目与新数据卷上执行，结果与镜像指纹进入发行记录；单独 SQL 导入成功不能作为系统恢复验收。
