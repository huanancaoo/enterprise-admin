# 变更记录

## 未发行

- Compose 支持持久 Local Files、显式 S3、强制 Worker 运行和真实历史源码回退；维护备份/恢复覆盖 PostgreSQL、Files 与 Redis。
- JSON 日志、HTTP/Queue/Worker OTel 传播、任务与 HTTP 指标、本地 Collector/Jaeger/Prometheus 和告警规则验证。
- 本地发行 gate、同批镜像扫描、CycloneDX SBOM、全文件哈希与离线加载；漏洞门禁失败不会生成最终 manifest。
- 固定 pnpm 12.11.2，修复生产可选 peer 闭包；Node 保持 26.8.2。API/Worker/Migrator 使用正式 prod deploy 与真实 Alpine/musl 产物。
- Apache-2.0、NOTICE、贡献及安全报告政策、模块/安装/升级/备份恢复/观测指南。

认证与组织、租户隔离、Projects、角色与审计、Files 和核心 Worker 的本机交付已形成基础。框架补齐范围与当前证据见 [实施规格](docs/architecture/framework-completion-spec.md)。

发行记录必须同时列出源码提交、应用与 Migrator 镜像摘要、迁移变化、升级前提、可回退目标与实际验收结果。未完成对应安装、升级、回退或恢复验收的源码不标记为生产发行版。
