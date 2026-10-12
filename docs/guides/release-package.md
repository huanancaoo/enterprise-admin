# Docker Compose 不可变发行包

发行由同一套实际镜像完成安装、升级、安全事实回退、Files 字节保留与维护恢复，再进行镜像扫描、SBOM 和最终 manifest 生成。发行包不携带环境文件、密钥或测试数据库备份。

## 生成

```sh
RELEASE_ROLLBACK_REF=<已接受的真实提交> node infra/release/verify.mjs <version> <new-release-directory>
```

`result.json` 只在完整恢复和本轮资源清理完成后标为 accepted。它绑定实际运行镜像及构建前取得的源码 tar/SHA-256；源码快照不包含 ignored 环境文件与依赖目录。Git 基线与源码快照共同描述有本地修改的测试来源，不把基线提交误称为快照的全部内容。

本地 gate 先执行完整 verify 和 release，再由生成器接收该轮记录。生成器拒绝未完成必要验收或源码校验不符的记录，对同一批 image ID 保存 Docker archive、生成 CycloneDX SBOM，再执行 HIGH/CRITICAL 镜像漏洞门禁。扫描失败保留报告供修复，缺最终 `manifest.json` 的目录不能作为发行包。manifest 包含镜像平台、全部源码/镜像/报告文件 SHA-256；安装目标须使用对应平台。扫描收集全部镜像的报告后统一判定，security-review.json 列出每镜像总数与有修复版本数。扫描工具的具体运行版本与 DB 时间保留在原报告中。

组件自身的配置、许可证、NOTICE、开发/升级/恢复指南保留于 `source`；`source.tar` 对应被验收的源码快照。包内 Compose 把基础服务映射到这批验收时实际运行的 image ID，以便从 Docker archive 离线加载；该固定输出也纳入 manifest 哈希。源码和包内 Compose 均不包含在线构建定义，发布只消费已准备镜像。源码仓库的基础配方锁定官方 FROM digest、源码提交与 tar 校验值、工具链和安全库版本，不允许任意环境变量替换基础镜像。`release.env.example` 填入该批应用/Worker/Migrator 的不可变 image ID，其他部署配置由安装方提供。

固定配方位于 `infra/release/base`，通过 `node infra/release/build-base-images.mjs` 构建。PG/Redis 保留既定主版本和 Bookworm，仅更新已确认安全库；PG 的 libc、locale、ICU 与时区数据固定。发布前的真实旧卷读回核对全量 collation catalog/actual version、数据库 locale/version 和原排序数据；Redis 用旧 RDB 验证键值、待处理顺序与延迟分数。不能通过刷新 collation 或重新索引掩盖版本变化。监控与 Mailpit 保留其正式源版本，固定修复 Go/模块并重编译运行二进制；Collector 配方包含发行配置实际使用的 OTLP、batch、Prometheus 与配置 provider。它们仍需通过同一套真实观测链路与告警规则验收。

本地基础构建明确使用 `--provenance=false`，避免 Docker 默认证明中的时间戳改变缓存重建的 OCI index ID，破坏备份与恢复绑定。连续两次正式固定构建验证全部 ID 一致；部署配置另验证不会触发 Compose 重建改变身份。来源由上述锁定配方、源码 tar、文件校验和、实际运行 ID 与 SBOM/扫描报告记录，仍进入不可变 manifest。不能依据运行层相同沿用另一 image ID 的扫描记录。

报告的 FixedVersion 为空只表示该扫描数据库未列出修复版本；需要按 CVE 核对官方发行安全记录。残余问题不会自动成为豁免，更不能通过删除扫描数据库记录、替换未接受的发行/locale 或放宽等级来生成包。

## 使用

先用正式入口校验全部文件和目标平台，再加载每个不可变镜像并核对实际 ID：

```sh
node <release-directory>/source/infra/release/load.mjs <release-directory>
```

环境文件保存在发行包目录以外。进入 `source` 目录，按 [安装升级指南](upgrade.md)配置环境并执行正式发布入口。保留上一已接受版本的发行包，回退目标需要对应实际验收，不能只依据版本号推断。

本地日志、SBOM、扫描与验收证据不表示已经在真实服务器、TLS 或外部邮件/OAuth 环境部署成功。本项目本次交付目标是 Docker Compose 包与本地安装升级回退恢复验收。
