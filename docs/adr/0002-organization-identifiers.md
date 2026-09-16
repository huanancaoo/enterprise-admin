---
status: accepted
date: 2026-09-15
---

# ADR-0002：统一使用 UUID 组织标识

认证模型、业务外键和租户隔离必须表达同一个组织，混用标识类型会使约束与授权链出现分叉。组织 ID 统一为 UUID v4，统一命名为 organizationId，数据库使用 uuid，HTTP 与 TypeScript 使用经 UUID Schema 校验的字符串。不引入同义 tenantId、带前缀 ID、ULID 或混合类型。

## 决策及影响

Better Auth 配置 UUID 生成策略，认证 Schema 由同版认证 CLI 生成；组织主键及成员、邀请、角色的组织外键均使用 uuid。Session 的 activeOrganizationId 显式配置为组织引用、不可由客户端直接输入，生成可空 uuid 外键，删除组织时置空；不手工修改生成 Schema 来修正默认 text 类型。

activeOrganizationId 只表示工作区偏好，不是访问凭据。每次业务请求仍验证目标组织、Session、Membership、组织状态和动作权限。

Projects 的 organizationId 是非空组织外键；项目译文同时携带非空 organizationId，并与 projectId 组成引用 Projects 的复合外键，防止译文归属与项目归属不一致。TenantContext、URL 和 JSON 采用同一 UUID 字符串约束。

PostgreSQL 事务上下文以文本保存组织标识，RLS 的 USING 与 WITH CHECK 都先将未设置或已清空的上下文归为 NULL，再转为 uuid 与行的 organizationId 比较。事务结束后自定义设置可能变为空字符串，因此需将空字符串视为无租户上下文；无效的非空 UUID 不能被转换成默认组织，HTTP 边界应拒绝非法标识。

该决定统一了类型与引用约束，但不能单独证明隔离完整；并发、撤权、回滚及运行角色的隔离证据见 [S3 验收记录](../architecture/s3-validation.md)。
