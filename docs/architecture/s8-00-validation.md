# S8-00：授权、事务与平台会话集成验证

日期：2026-09-17。任务 [#9](https://github.com/huanancaoo/enterprise-admin/issues/9)，父规格 [#8](https://github.com/huanancaoo/enterprise-admin/issues/8)。本次交付可复现探针、入口盘点和 ADR，**不交付 S8 管理页面或生产迁移，也不宣称 S8 安全验收通过**。

## 环境与复现

基线提交 `00092fd8eff37d97196b5ce4fa39a837872c30d9`。实际安装版本：Better Auth / Drizzle Adapter 1.7.5、Drizzle 0.45.2、pg 8.23.0；PostgreSQL 镜像采用 versions.json 的固定镜像。Node/pnpm 以根 package.json 为准。

```sh
pnpm exec turbo build --filter=api
pnpm exec vitest run --config vitest.config.mjs --project api tests/api/organization-integration.test.mjs tests/api/mfa-integration.test.mjs
pnpm typecheck
pnpm verify
```

组织测试复用现有 `tests/api` Vitest 入口、真实 Nest auth HTTP handler、生产 createAuth、Testcontainers/bootstrap/唯一迁移链。运行写入使用 app_runtime；migrator 只布置故障触发器、核对提交结果和邮箱验证前提。不读取开发库 URL。锁屏障通过 pg_locks 等待真实写请求到达，不用固定延时猜竞态。仅测试临时容器内安装触发器，结束销毁。

MFA 测试使用同版本 Better Auth 的公开 handler 与 2FA/magic-link 插件，在另一临时数据库由上游生成器建表，使用受限 app_runtime 执行请求。**此实验使用 PostgreSQL 原生适配器，不是生产 Drizzle 适配器**，只证明插件会话行为。实验库的批量 GRANT 仅限隔离测试，不是生产迁移授权模板。测试中的 sendOTP/sendMagicLink 捕获测试验证码和链接，不证明 SMTP 投递。

## 当前生产入口盘点

`apps/api/src/create-application.ts` 将 `/api/auth/*path` 直接交给 `toNodeHandler(runtime.auth)`，先于业务 JSON parser。Nest TenantGuard/AuthorizationService 只保护业务 Controller，不能保护此原生分支。`packages/database/src/auth.ts` 配置 Organization + Dynamic Access Control，未配置 2FA、OAuth、magic link、OTP 登录或 Teams。

以下清单从实际 `auth.api` 的 path/method 读取；HTTP 前缀为 `/api/auth/organization`。不能把上游存在的 Teams 源码误认为已挂载。

| 方法         | 路径                                                                      | 公开内部 API                                                              |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| POST         | create / update / delete                                                  | createOrganization / updateOrganization / deleteOrganization              |
| POST         | set-active / check-slug                                                   | setActiveOrganization / checkOrganizationSlug                             |
| GET          | get-organization / get-full-organization / list                           | getOrganization / getFullOrganization / listOrganizations                 |
| POST         | invite-member / cancel-invitation / accept-invitation / reject-invitation | createInvitation / cancelInvitation / acceptInvitation / rejectInvitation |
| GET          | get-invitation / list-invitations / list-user-invitations                 | getInvitation / listInvitations / listUserInvitations                     |
| POST         | remove-member / update-member-role / leave                                | removeMember / updateMemberRole / leaveOrganization                       |
| GET          | list-members / get-active-member / get-active-member-role                 | listMembers / getActiveMember / getActiveMemberRole                       |
| POST         | create-role / update-role / delete-role                                   | createOrgRole / updateOrgRole / deleteOrgRole                             |
| GET          | list-roles / get-role                                                     | listOrgRoles / getOrgRole                                                 |
| POST         | has-permission                                                            | hasPermission                                                             |
| 无 HTTP path | 仅服务器调用                                                              | addMember                                                                 |

HTTP handler 与 auth.api 公共调用共享插件，但纯服务器调用不自动证明最终用户身份；addMember 尤其不能暴露为不校验身份的 Controller。项目策略需覆盖所有调用方，而不只对某 URL 加中间件。

## 锁定源码与挂载点

复核安装包 `better-auth/dist/plugins/organization/routes/{crud-org,crud-members,crud-invites,crud-access-control}.mjs`、`organization/adapter.mjs`、`two-factor/{index,verify-two-factor}.mjs` 和 `@better-auth/drizzle-adapter/dist/index.mjs`：

- Organization hooks 可拒绝相应生命周期操作，但 leave 与动态角色 CRUD 没有与成员更新等价的成对 hook；不能假定一个 hook 覆盖全部入口。
- Drizzle adapter 的 transaction 选项默认 false。当前 createAuth 未启用；调用方 Drizzle transaction 的 tx 未传给认证适配器。
- 最后 owner 的查询与删除分开执行；动态角色删除先查成员引用，未查 pending 邀请引用，也未将检查/分配/删除串行化。
- 邀请接受先以 pending 条件认领 accepted，再写 Member/Session；后续失败会尝试恢复 pending。补偿不等于所有已提交写入回滚。
- Session activeOrganizationId 是工作区偏好；原生操作可更新它，但 URL/Header/Body 与该值均不能代替授权。默认未启用 Cookie session cache，撤销测试使用原 Cookie 请求权威 Session。
- 2FA 登录拦截器匹配 email/username/phone-number 登录。社交登录等其他方式不能据此认定已覆盖，生产当前也未配置这些方式。
- 未登录的第二因素成功会创建新 Session；已有 Session 的验证返回原 Session。可信设备可让密码登录跳过挑战；原生 Session 没有项目要求的 verifiedAt/method 事实。

## 可复现结果与安全判定

测试名称刻意标明当前行为。**探针成功复现缺陷不等于安全不变量通过**；后续修复这些行为时，应将对应特征断言替换为父规格的安全断言。

| 探针                        | 当前观测                                                         | S8 判定                                       |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| 外层事务抛错                | auth.api 创建的组织仍已提交                                      | 未通过：不能用外层事务承载审计原子性          |
| before/after 审计数据库失败 | before 拒绝且不变；after 拒绝但成员角色已改，无审计              | 未通过：after hook 不可保证成功审计           |
| 数据库同语句触发器审计失败  | HTTP 500，成员角色回滚                                           | 仅数据库原子性原理通过，未证明可信上下文      |
| 两 owner 并发退出           | 两个 200，最终零 owner                                           | 未通过 INV-07                                 |
| 角色删除与分配并发          | 删除检查后分配成功，随后删除成功                                 | 未通过：悬空角色                              |
| pending 邀请引用角色        | 角色删除成功，邀请保留已不存在角色 key                           | 未通过：角色引用完整性                        |
| 邀请接受 Session 写失败     | HTTP 500，邀请恢复 pending，但 Member 已提交                     | 未通过：接受事务一致性                        |
| 同邀请并发接受与重放        | 一次成功、一个 Member；重放拒绝                                  | 该窄场景通过，不证明接受/取消竞态或移除后重放 |
| 停用组织原生完整读取        | HTTP 200 返回组织                                                | 未通过 INV-08                                 |
| 生产 MFA 入口               | verify-totp 为 404；退出后旧 Cookie 无 Session                   | MFA 未集成；旧 Cookie 撤销窄场景通过          |
| 隔离 OTP 启用               | Session 轮换，旧 Session 不可用；只有 enabled 标志               | 不是当前会话近期验证证明                      |
| 隔离密码登录 + OTP          | 登录挑战无 Session；错码拒绝，正确 OTP 后新 Session              | 第二因素成功行为通过，assurance 集成未证明    |
| 隔离 magic-link 登录        | 已启用 2FA 的用户未经过第二因素挑战即取得 Session，无 verifiedAt | 第二种登录方式不能自动赋予平台 assurance      |
| 已有 Session 验证 OTP       | 验证成功，Session ID 保持不变                                    | 需绑定当前 Session 单独记录 verifiedAt        |
| 隔离可信设备再登录          | 跳过挑战，得到另一 Session，仍无 verifiedAt                      | 不能作为平台 MFA 事实                         |

## 固定实施路径与阻塞

[ADR-0005](../adr/0005-organization-management-integration.md) 选择父规格要求的数据库不变量与同事务审计路径；[ADR-0003](../adr/0003-platform-access.md) 固化双平台角色、部署 CLI、ACTIVE/SUSPENDED 单一状态、Session assurance、固定函数/NOLOGIN executor。没有把旧 ADR 的 enabled 或单角色范围用来削减 S8。

以下未通过或尚未证明项是后续相关能力的发布阻塞，不是默许跳过的验收项：

1. **组织管理写入**：真实 auth 写连接的可信 actor/request/组织/版本绑定尚未实现或验证。必须证明连接复用不串上下文、无上下文拒绝、事务锁覆盖 owner/角色/邀请及成功审计；不能只把本探针的触发器复制到生产。
2. **邀请事务**：接受失败存在部分提交；接受与取消并发、移除后旧邀请重放、原邀请者撤权、有效邀请唯一性与邮件失败语义仍需验证。
3. **平台会话**：生产 Drizzle 2FA Schema/迁移、成功验证→assurance 原子记录、平台 step-up 门禁和 assurance 随过期/撤销/轮换失效均未完成端到端证明。密码、可信设备、magic-link 与已有 Session OTP 仅完成隔离插件行为验证；OAuth 等未配置方式不得据此开放。当前不能开启平台能力。
4. **平台数据库通道**：固定函数、executor、CLI、审计和状态迁移尚未交付；现有直接列权限不符合新 ADR，必须迁移并重新运行隔离套件。

这些阻塞允许继续在隔离环境实施后续集成，但不允许宣称被阻塞的管理能力已验收。本文没有把技术验证任务扩展为父规格全部功能。

## 检查记录

- 聚焦探针：2 个文件、11 个测试通过（组织 10 个，MFA 1 个多步骤流程）。这里的通过表示证据可复现，安全结论以表格为准。
- `pnpm verify` 的 peer、lint 和 typecheck 通过；在既有 i18n 检查处停止：zh-CN/en-US/ar 的 `projects.open` 被提取器判定为多余键。本次未修改翻译或 UI，该阻塞未修复。
- 为避免短路遗漏，继续独立执行后续全部入口：`test:unit` 36、`test:api` 36（含本次 11）、`test:storybook` 82、`test:e2e` 15、`test:database` 13 个测试全部通过；`db:check`、`build`、`api:check` 通过。
- 新增 magic-link 场景及提取测试 fixture 后，重新运行受影响的两个探针文件；不以此前运行结果覆盖后续修改。
- 验证过程中当前分支新增了无关的技能文档提交 `8d75d1d`，业务基线未变；本任务保留该提交和已有未跟踪的 `organization-entry-ux.md`。
- 未运行部署、生产数据修改或远端 CI。全量门禁因上述 i18n 阻塞不能宣称全绿。
