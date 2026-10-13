# 变更记录

## 0.1.0 本地候选（2026-10-13 更新）

本轮确认的八项能力已完成本地实施与验收，范围见 [实施规格](docs/architecture/framework-completion-spec.md)，分层质量及发行证据见 [验收记录](docs/architecture/framework-completion-validation.md)。该状态表示本地候选包形成，不表示已在 GitHub 发布或完成实际生产部署。

- 自托管发行与恢复：Compose 包含必需 Worker、持久 Local Files 与显式 S3；维护停写备份和恢复覆盖 PostgreSQL、Files、Redis，验证安装、升级、真实历史源码回退及恢复后的业务和权限事实。
- 业务模块开发指南：贯通 Schema → Migration/RLS → TenantTx → Policy → Contract/API → OpenAPI/Orval → 页面、i18n 与测试，并完成独立照做验证。
- 运行观测与告警：受控 JSON 日志、HTTP/Queue/Worker OTel 传播、任务与 HTTP 指标，本地 Collector/Jaeger/Prometheus 和告警验证。
- 业务通知：导入导出完成或失败生成发起人的站内通知与已读状态；邮件按当前偏好发送给仍是成员的发起人，API HTTP 启动后自动投递。
- 数据导入导出：Projects CSV/XLSX，原始文件最大 10 MB、XLSX 单工作表；仅创建，整批校验后一次提交；导出全部已应用筛选结果，下载重查当前授权。
- 通用任务中心：聚合业务任务与 Files 操作，保留各自生命周期；成员查看本人任务，owner/admin 可查看组织任务。
- 个人账户安全中心：两个后台接入原生密码与邮箱变更、会话查看和撤销；修改密码撤销其他会话并保留当前登录，平台新会话重新验证 MFA。
- 对外系统集成：原生调用凭据绑定现有用户与组织，权限受凭据范围和当前成员权限共同限制；Webhook 发送签名薄事件，保留持久重试和投递记录。

PostgreSQL 18.6 与 Redis 7.4.5 保持版本，正式发行切换固定 Alpine 基线。已有 Bookworm 安装用 v2 停写快照，经专用 CLI 逻辑恢复到新卷、重建索引并验收目标排序；普通恢复仍要求基础镜像及排序元数据一致。Node 保持 26.8.2、pnpm 固定 12.11.2；API/Worker/Migrator 使用正式 prod deploy 与 Alpine/musl 产物。

2026-10-12 正式发行 20/20 通过，同批 11 个实际镜像的 CycloneDX SBOM 和 Trivy 零 HIGH/CRITICAL 门禁通过。最终本地包位于 `test-results/framework-release-0.1.0-accepted-20261012`，已生成 `manifest.json`；包内公开加载入口核对 11 个实际镜像 ID 与 linux/arm64 平台一致，1792 个文件哈希全部通过。源码基线为 `dc8fc073d388d67cc91f7fcd815d3354274b7419`，源码快照 SHA-256 为 `d471ac0814fa11b6952d0de02e2a90829bfedbbea521cbc0cc94ab7858fe320e`，实际镜像身份及逐文件摘要以包内 manifest 为准；可追溯摘要见[发行证据](docs/artifacts/framework-release-0.1.0-20261012.json)。

本轮批准的开源最小清单包含 Apache-2.0 LICENSE、NOTICE、贡献与安全报告政策、变更记录，以及模块、安装、升级、备份恢复和观测指南。原实施建议中的 CODE_OF_CONDUCT 未纳入本轮确认范围，未新增。

发行记录必须同时列出源码提交、应用与 Migrator 镜像摘要、迁移变化、升级前提、可回退目标与实际验收结果。未完成对应安装、升级、回退或恢复验收的源码不标记为生产发行版。
