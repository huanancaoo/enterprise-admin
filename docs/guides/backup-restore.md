# 维护停写备份与恢复

备份边界是同一安装的 PostgreSQL、Files 对象与 Redis 持久状态。API、Worker 和两个 SPA 在同一个维护窗口停止；认证邮件、Files 维护和队列执行也随所属进程停止。该窗口禁止直接向数据库、Redis 或对象命名空间写入。

## 备份

从发行源码目录执行，目标目录必须尚不存在：

```sh
node infra/release/backup.mjs <compose-project> <release.env> <new-backup-directory>
```

命令核对实际运行镜像、Files 配置与部署密钥是否匹配，停止入口与写入者，等待正常排空，再冻结 Redis。随后取得 PostgreSQL custom dump、完整 Redis 数据目录，以及 Local 私有目录或 S3 当前私有前缀下的对象、内容摘要和元数据。

`manifest.json` 最后写入；缺 manifest 的目录不作为完成的备份。它包含镜像 ID、文件 SHA-256、存储类型和认证/邮件加密密钥的指纹，未保存密钥原文。备份内容仍包含认证与业务数据，目录保持 0700、文件保持 0600，由部署方保管。

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

## 验收事实

恢复后通过正式 HTTP/浏览器重新验证：原用户与会话、组织和项目、文件当前及固定版本字节、未完成操作、任务结果，以及停用组织、移除成员和平台撤权仍生效。恢复代表备份时刻的事实；备份之后的操作不在该快照内。

```sh
RELEASE_ROLLBACK_REF=<已接受的真实提交> pnpm test:release
```

测试在专属项目与新数据卷上执行，结果与镜像指纹进入发行记录；单独 SQL 导入成功不能作为系统恢复验收。
