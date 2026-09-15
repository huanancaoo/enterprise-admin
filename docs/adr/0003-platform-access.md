# ADR-0003：平台权限与跨租户访问

- 状态：已接受
- 日期：2026-09-15
- 对应任务：S0-06
- 业务范围：用户已明确确认

## 身份与授权模型

平台人员复用 Better Auth User/Session。平台授权与 Organization Role 完全独立：成为任何组织的 owner/admin 不产生平台权限，访问平台 SPA 或提交平台路由也不产生权限。

首版只设固定角色 `platform_admin`，能力为下表的显式集合。用 `platform_grants` 保存 `user_id uuid`（唯一并引用 Better Auth user）、固定角色、授予者与时间。它只记录平台任职，不重复建模组织 Member/Role，也不提供动态平台角色编辑器。

首位平台管理员通过部署管理命令授予已存在的用户，操作者标记为 `bootstrap` 并记录审计；不采用“首位注册用户自动成为管理员”、邮箱域名判断或前端配置授权。后续授予/撤销要求有效平台管理员身份并记录操作者。当前请求重新读取平台授权，不将平台角色长期固化到前端或 Session 快照。

## 允许的操作

| Permission                          | 范围                                                            |
| ----------------------------------- | --------------------------------------------------------------- |
| platform:organization:read          | 组织标识、名称、状态等运营元数据                                |
| platform:organization:update-status | 启用/停用组织                                                   |
| platform:user:read                  | 用户公开身份与组织关联元数据，不返回密码、token、session secret |
| platform:audit:read                 | 跨组织查询结构化审计事实                                        |
| platform:settings:read/update       | 平台设置                                                        |
| platform:access:grant/revoke        | 授予/撤销平台角色，审计记录必须成功                             |

首版不允许代登录、读取或修改租户 Projects/译文，也不提供任意 SQL、通用跨租户业务查询或万能资源操作端点。用户在某组织具有 Membership 时，访问该组织 Projects 仍走普通租户授权链。

组织停用只改变组织状态。S4/S8 必须在下一次受保护请求中检查该状态，使组织业务访问被拒绝；启用不隐式授予或恢复已撤销的成员权限。

2026-09-15 用户确认：现有组织与新建组织默认启用。组织状态使用 Better Auth Organization 的 `enabled` 布尔扩展字段，非空且默认 true；客户端不能设置该字段。启停属于平台权限，普通租户运行账号无该列 UPDATE 权限。

## 数据库访问路径

同一个 NestJS API Host 内建立两个明确的访问入口：

1. 租户业务：Identity/Authorization 验证后，`app_runtime` → TenantTx → 显式组织过滤 + RLS。
2. 平台业务：Identity 验证后，PlatformGuard 读取平台授权 → 对具体动作授权 → PlatformRepository 使用独立 `platform_runtime` Pool。

`platform_runtime` 是非 Owner、NOSUPERUSER、NOBYPASSRLS、无 DDL 的角色。不授予它任何 Projects/译文表权限，也不让 `app_runtime` 成为它的成员。migrator/bootstrap 凭据不注入 API。

S2/S8 为平台角色按清单授予用户/组织所需元数据 SELECT、组织状态列 UPDATE、平台设置/平台授权的必要操作和审计 SELECT/INSERT；不能授予整个 schema 的表级通配权限。凭据属于服务端 Platform 模块，Repository 不把该 Pool 传给租户业务模块。

租户审计读取受组织 RLS；平台审计读取使用只针对 `platform_runtime` 的显式 SELECT policy。平台跨组织能力仅限审计表和运营元数据，不能靠 BYPASSRLS 扩大到业务表。现有 Better Auth 组织关系仍是唯一成员事实来源。

数据库角色隔离限制误用范围；平台动作授权仍由服务端 Guard/Policy 完成，数据库 GUC、URL 和应用拆分均不是身份凭据。

## 审计约束

平台记录包含 `eventCode`、actorId（或明确 bootstrap 操作者）、目标 organizationId（纯平台事件可空）、动作、资源类型/ID、结果、requestId、时间。审计不复制租户业务正文或凭据。

- 成功变更及审计记录在同一数据库事务提交；审计写入失败则该变更回滚。
- 跨组织查询在返回结果前记录审计；审计失败不返回数据。
- 已识别身份的越权操作记录 denied 结果；不接受客户端自报 actorId。
- 平台角色授予与撤销均审计，普通 runtime 没有修改审计历史的权限。

## 后续验收

S8 必须验证组织 owner/admin 被平台 API 拒绝、平台角色撤销后请求被拒绝、平台启停组织影响后续租户访问、平台不能读取 Projects、审计缺失时动作不能成功。S0 冻结模型与数据库通道，不将这份 ADR 当作平台授权实现已完成。
