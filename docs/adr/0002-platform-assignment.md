---
status: accepted
date: 2026-09-18
---

# 平台任职由部署 CLI 授予已验证用户

平台后台没有注册入口。平台权限只来自独立的任职表，组织角色、打开平台后台的路由、Cookie 或 Header 都不能产生这个身份。目标用户先通过正常认证完成注册和邮箱验证，再由部署操作者授予任职。

部署 CLI 的 grant/revoke 接受精确用户 UUID、platform_admin 或 platform_auditor，以及非空审计原因。grant 检查用户存在且邮箱已验证；CLI 不创建账号、不修改邮箱验证状态，也不提供 HTTP 任职管理接口。任职变更与内部审计在同一事务提交。

CLI 使用专用部署连接 `PLATFORM_ASSIGNMENT_DATABASE_URL`，不向在线 API 注入该凭据。API 统一使用 `DATABASE_URL`，每次平台请求重新检查权威 Session、有效任职和当前会话 MFA 事实；撤销后旧 Session 的下一请求被拒绝。

## Considered Options

- **公开注册的首位用户自动成为平台管理员**：注册和平台任职分别产生事实；否决。
- **CLI 给已存在且已验证邮箱的用户授权**：复用正常账号认证和邮箱验证，以精确 UUID 明确指定目标；采用。
- **CLI 创建账号并跳过邮箱验证**：将账号生命周期与任职授权混在一起，不符合已接受的授权边界；否决。
- **组织 owner 自动成为平台管理员**：两个任职会互相推导；否决。

## 依据与证据

本文与已完成的 [#19](https://github.com/huanancaoo/enterprise-admin/issues/19) 及 [S8 集成约束](../architecture/s8-integration-contract.md) 对齐。[真实 CLI 测试](../../tests/api/platform-assignment.test.mjs) 核对已验证用户授予、未验证用户拒绝、重复操作、角色变更、撤销及任职/审计持久化；平台访问测试另核对 MFA 和撤销后旧 Session 拒绝。这些证据不表示已经完成生产部署。
