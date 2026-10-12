# 安装、升级与回退

发行包记录应用、Worker、Migrator 和基础服务的不可变镜像，以及明确的平台架构。部署使用与 manifest 相同的镜像，不按 mutable tag 重选构建，也不以重新打标签冒充历史版本。

## 首次安装

校验发行 manifest，加载发行包中的 Docker 镜像。将 `release.env.example` 复制为私有配置文件，提供五个数据库口令、认证/邮件加密密钥、邮件与 OAuth 配置、监听地址以及 Files 的明确存储配置。不要将该文件放入镜像或提交 Git。

```sh
node <release-directory>/source/infra/release/load.mjs <release-directory>
cd <release-directory>/source
node infra/release/publish.mjs <compose-project> /private/path/release.env
```

正式命令从发行包的 `source` 目录执行；环境文件可使用绝对路径。首次空卷建立角色，Migrator 完成后才发布 API、必需 Worker 和双 SPA。按 README 完成真实注册、验证邮箱、组织/项目和文件流程；平台任职只由部署 CLI 按已验证用户 UUID 授予。

## 已有数据升级

先取得 [维护备份](backup-restore.md)，保留上一已接受发行包与镜像。沿用当前数据卷及原认证/邮件加密配置，审查该次迁移和升级前提。已有数据库角色升级先按数据库说明由 DBA 执行，不把 bootstrap 当成已有卷的升级机制。

更新应用、Worker 与 Migrator 的镜像配置，再执行同一个发布入口。迁移失败不会替换在线应用；Worker 未就绪不会发布后续 SPA。SQL/ledger、业务授权与 API 代理错误必须保持原语义。

发行只接受已在当前迁移上实际验证的回退目标。若某次迁移删除了该目标仍需要的结构，先建立并验收新的回退基线，再发行该变化；不为旧二进制加入适配分支，也不通过 down migration 删除新业务事实来使其启动。

## 已验收目标回退

保持最新 Migrator、数据卷和持久配置，只选定已在当前迁移和当前安全事实下完成实际回退验收的应用/Worker 镜像。发布前核对目标 Worker 支持当前全部已注册任务类型；缺失时拒绝更换容器，保留 UnknownTask 的永久拒绝规则。

历史 API 必须继续拒绝停用组织、被移除成员与被撤销平台任职的旧会话。历史 Worker 必须理解当前任务与持久结果；不能把空注册表的历史 Worker 作为新业务任务的回退证明。每次目标改变重新执行真实源码构建与对应验收。

回退后核对实际运行 image ID、迁移 ledger、文件字节、任务结果和同一旧 Cookie 的访问结果，再完成深链接、刷新、登录、登出与 API 错误代理 smoke。
