---
status: accepted
date: 2026-09-15
---

# ADR-0003：独立授予平台权限并限制跨租户访问

平台运营需要管理组织和查询审计，但组织管理员身份不应获得跨租户业务权限。平台人员复用 Better Auth User/Session，平台授权独立于 Organization Role，并通过专用数据库角色访问明确列出的运营数据。这样平台能力由动作授权和数据库权限共同限定，不依赖前端入口或绕过 RLS。

## 决策及影响

首版只有固定角色 platform_admin，不提供动态平台角色编辑器。platform_grants 以唯一的用户 UUID 引用 Better Auth User，保存固定角色、授予者与时间，只表示平台任职，不复制组织 Member/Role。组织 owner/admin、平台 SPA 或平台 URL 均不产生平台权限；每次请求重新读取授权，不依赖长期保留的前端或 Session 角色快照。

首位管理员通过部署管理命令授予已存在用户，以 bootstrap 标记操作者并记录审计；不采用首位注册、邮箱域名或前端配置授权。后续授予和撤销均要求有效的平台管理员身份并记录操作者。

| 平台权限                            | 允许范围                                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| platform:organization:read          | 组织标识、名称、状态等运营元数据                              |
| platform:organization:update-status | 启用、停用组织                                                |
| platform:user:read                  | 公开身份和组织关联元数据，不返回密码、token 或 session secret |
| platform:audit:read                 | 跨组织结构化审计事实                                          |
| platform:settings:read/update       | 平台设置                                                      |
| platform:access:grant/revoke        | 授予、撤销平台角色，审计必须成功                              |

平台角色不允许代登录或读写租户 Projects/译文，不提供任意 SQL、通用跨租户业务查询或万能资源端点。平台人员如同时是某组织成员，访问其 Projects 仍通过普通租户授权链。

现有和新建组织默认启用，状态由 Better Auth Organization 的非空 enabled 布尔扩展字段表达，默认 true 且不允许客户端设置。启停仅改变组织状态：停用后下一次受保护业务请求必须被拒绝，重新启用不授予或恢复已撤销的成员权限；普通租户运行账号没有该列的 UPDATE 权限。

同一个 API Host 保留两条访问路径：租户请求通过身份和组织授权后，由 app_runtime 使用 TenantTx、显式组织过滤与 RLS；平台请求通过身份验证、PlatformGuard 和具体动作授权后，由 PlatformRepository 使用独立 platform_runtime Pool。该 Pool 与凭据仅属于服务端平台模块，不传入租户业务模块，migrator/bootstrap 凭据不注入 API。

platform_runtime 为非 Owner、NOSUPERUSER、NOBYPASSRLS、无 DDL 的数据库角色；它没有 Projects/译文表权限，app_runtime 也不是它的成员。权限按清单授予：用户和组织元数据 SELECT、组织状态列 UPDATE、平台设置和授权的必要操作、审计 SELECT/INSERT，不授予整个 schema 的通配表权限。

租户审计读取受组织 RLS 限制，平台审计读取通过仅面向 platform_runtime 的显式 SELECT policy。跨组织能力只涵盖审计与运营元数据，Better Auth 组织关系仍是唯一成员事实来源；数据库角色限制误用范围，具体动作仍由服务端 Guard/Policy 授权，GUC、URL 或应用拆分不是身份凭据。

平台审计记录 eventCode、可信 actorId 或 bootstrap 操作者、目标 organizationId（纯平台事件可空）、动作、资源类型与 ID、结果、requestId 和时间，不复制租户业务正文或凭据。成功变更与审计同事务提交，审计失败则回滚；跨组织查询在返回前必须成功记录审计；已识别身份的越权操作记录 denied，不采信客户端 actorId。授予与撤销均审计，普通 runtime 无权修改审计历史。

组织管理员访问平台被拒绝、撤销授权立即影响后续请求、组织启停生效、平台不能读取 Projects 及审计失败阻止动作成功，均是此边界的验收条件。实施阶段见 [实施计划](../architecture/implementation-plan.md)的 S8；本决策的接受不代表平台功能已交付。
