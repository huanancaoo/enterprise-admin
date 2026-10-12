# 通用框架补齐：后端实施研究

研究日期：2026-10-11（Asia/Shanghai）。源码基线：`9880af6f40a0c9884305c27a1a5a5a717b253fe7`。本稿覆盖已确认八项工作中的后端接入问题：业务通知、导入导出、通用任务、外部调用身份与 Webhook、安全中心；不重新定义父任务的八项清单。SSO、SCIM、Billing 是否纳入由父任务与用户确认，本稿不增加这些范围。这里只记录事实、实施前决策和测试入口，没有编写生产代码或测试。

## 结论

基础设施已经存在，主要工作是把能力连接为完整业务流程。当前的关键约束不是库是否支持，而是身份归属、操作权限、提交边界、结果可见范围及失败后的业务事实。应先明确少量会改变业务语义的决策，再完成具体功能的纵向切片。

- 不重造 Better Auth 已有的密码、邮箱验证、Session、TOTP、恢复码和 API Key 机制。
- 不把外部 SMTP/HTTP 发送放进当前整段数据库任务事务，宣称数据库提交等同外部成功。
- 不把 BullMQ Job 去重当作持久业务幂等，也不把 Redis 队列历史直接当作租户任务目录。
- 不把组织 RLS 当作本人/部门数据权限，也不为组织凭据虚构一个普通用户 Session。
- 新能力的成功审计必须标识实际资源；现有 Project 审计记录方法不能原样用于所有领域。

上述约束来自[任务接入规范](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/docs/guides/worker.md#L22)、[数据库边界](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/README.md#L141)、[当前身份校验](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/identity/identity.service.ts#L27)及下列具体源码。

## 已有能力及准确接入点

| 能力             | 已有接口                                                      | 实施约束                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 当前登录身份     | `IdentityService.getIdentity/requireIdentity`                 | 调用原生 `getSession` 后，再查当前 `public.session`；过期或撤销立即失效。不是任意 token 转 userId。[源码](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/identity/identity.service.ts#L27)                                                                                                                                                                                                                                                            |
| 组织上下文       | `TenantContextService`、`TenantGuard`                         | 验证真实成员、当前组织状态、资源动作；组织与用户取可信上下文。[源码](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/tenancy/tenant-context.service.ts#L59)                                                                                                                                                                                                                                                                                            |
| HTTP 业务事务    | `createTenantRunner` / `TenantTx`                             | 所有查询必须在回调结束前完成；事务不能跨回调保存。新租户表同时需要 RLS、显式 GRANT 和租户 Repository。[说明](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/README.md#L24)                                                                                                                                                                                                                                                                       |
| 队列提交         | `createTaskProducer().submit`                                 | 复核当前权限、读回 Redis 真实 Job；有 `unknown` 提交结果，不能在 UI 改称成功。[源码](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/jobs/src/runtime.ts#L113)                                                                                                                                                                                                                                                                                             |
| 任务执行         | `TaskDefinition`、`startTaskWorker`、`createTaskTenantRunner` | 当前 `execute(tx, task)` 在单个 TenantTx 中执行；组织状态及当前成员角色等锁后读取。[契约](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/jobs/src/contract.ts#L51)、[执行](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/jobs/src/runtime.ts#L260)、[查权](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/task-tenant.ts#L31) |
| 认证邮件         | `EmailService.hooks`、已有 dispatcher/SMTP Provider           | 模板当前只有邮箱验证、密码重置与邀请；认证邮件投递不应被重新实现为通知平台。[模板](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/email/templates.ts#L6)、[邮件服务](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/email/email.service.ts#L43)                                                                                                                                            |
| 文件/结果内容    | `FileStorage` 的流式 `write/open`、Files 受控入口             | 物理存储接口不负责业务授权、生命周期和版本；复用 local/S3 Provider 不等于直接暴露存储地址。[接口](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/files/storage/storage.ts#L56)                                                                                                                                                                                                                                                                        |
| 审计             | `auditRepository.record`、现有审计查询                        | 当前 record 固定 `resourceType: "project"`，必须为新资源定义准确的审计写入契约；不能产生伪 Project 事件。[源码](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/repositories/audit.ts#L29)                                                                                                                                                                                                                                                    |
| 两端 Auth 客户端 | `createWorkspaceAuthClient`                                   | 已安装 organization、lastLoginMethod、twoFactor 客户端插件；两端通过各自 Origin 的代理和 Cookie 获取身份。[源码](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/admin/src/auth/client.ts#L18)                                                                                                                                                                                                                                                             |

当前生产任务注册表为空；邮件、Files 和保留维护有各自执行路径，尚无通用任务目录、事务投递 outbox、任务 HTTP/UI。它们不是未实现基础队列的证明。[生产注册表](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/worker/src/registry.ts#L3)、[明确交付边界](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/docs/guides/worker.md#L48)。

## 业务通知

### 尚需决定

必须明确首个业务触发事件、接收人选择规则、通知是否只在组织内存在、成员被移除后历史通知是否可见，以及首版提供站内通知还是同时提供业务邮件。不同答案会改变模型、权限和投递流程；不能只新增一个“通知中心”页面便声称闭环。

父任务可向用户提交一个具体首版建议，例如只围绕获准示例领域的一组确定事件，明确收件成员和渠道；需要用户确认，不能把此建议自动当作需求。无需提前加入 SMS、Push、多 Provider、租户自带 SMTP 或消息编排器。

### 接入及测试入口

在具体业务 TenantTx 中记录需要通知的持久事实，让通知读取/标记已读通过可信组织与接收人身份校验。若要求业务提交后可靠发送邮件，需要先写持久投递意图再由异步执行器发送，不能仅在请求结束后向 Redis 临时 `add`。这是从现有跨数据库/Redis非原子边界推导出的实施约束。[项目创建与审计事务](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/projects/projects.ts#L41)、[投递边界](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/docs/guides/worker.md#L48)。

建议公开行为入口：业务命令 → 通知列表/未读数量 → 标记已读 → 再次读取。测试应验证跨组织/非接收人不可见、重复执行不重复通知、业务回滚不产生通知；业务邮件采用真实 Mailpit 验证投递，仅在已确认提供邮件渠道时执行。

## 导入与导出

### 尚需决定

1. 首个真实资源及文件格式：Projects 的哪些字段、是否只做 CSV、是否包含译文/附件/富文本。字段与格式不能从“支持导入导出”自行推断。
2. 导入语义：只新增还是允许更新；唯一匹配键是什么；有坏行时整批拒绝还是合法行提交；预览校验后提交时数据变化如何处理。
3. 导出语义：当前筛选结果还是勾选项目；提交时快照还是 Worker 执行时数据；请求语言、内容语言、默认语言分别如何影响列内容。
4. 最大行数、文件字节数、结果保留时间，以及导入/导出动作授予哪些角色。需要具体边界，而不是任意大文件能力。

CSV 标准约定了字段引号、逗号、换行及双引号转义；CSV 解析器应按约定工作，不能 `split(',')`。[RFC 4180](https://datatracker.ietf.org/doc/html/rfc4180)。若供电子表格打开，还需明确公式型文本的输出策略，否则普通业务文本可能被解释为公式；此策略可能改变导出的表示，应记录而非隐式猜测。[OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection)。

### 接入及测试入口

复用 Projects 的输入 Schema、译文规则、TenantTx 和受控文件 Provider，不绕过现有授权、业务校验及审计。[Projects 业务入口](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/projects/projects.ts#L41)、[列表语言与分页规则](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/repositories/projects.ts#L80)。

当前任务契约是单事务提交；如果确认分批/部分成功导入，必须先定义每批持久结果和幂等，不得在现有单事务 callback 内制造已经提交的批次。导出结果有单独授权与生命周期，不能把队列 `returnvalue` 大文件或物理 S3 key 当下载接口。[TaskDefinition](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/jobs/src/contract.ts#L51)。

建议公开入口：上传/校验 → 确认导入 → 任务查询 → 结果报告；创建导出 → 查询 → 受保护下载。测试用真实 PostgreSQL/Redis 和正式 Worker 检验坏行策略、重复提交、并发相同幂等键、导出筛选与语言、当前撤权后读取/执行、结果过期。CSV 编解码另以输入输出行为测试引号、换行和 Unicode，不测试内部 helper 调用顺序。

## 通用任务中心及可靠外部投递

### 已有执行语义必须保留

任务提交/执行查当前成员与角色；浏览器退出或 Session 到期不自动取消任务。成员移除、撤权、组织停用和资源范围拒绝是永久拒绝，恢复权限不自动重放已拒绝 Job。[既有规则](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/docs/guides/worker.md#L31)。

BullMQ 支持 attempts/backoff，但重试要靠业务幂等；移除 Job 后相同 ID 可再次入队。因此持久操作事实与队列尝试状态需要分别表达。[重试](https://docs.bullmq.io/guide/retrying-failing-jobs)、[幂等任务](https://docs.bullmq.io/patterns/idempotent-jobs)、[Job ID 去重范围](https://docs.bullmq.io/guide/jobs/job-ids)。

### 尚需决定

任务目录谁可见：仅本人、具备任务读取动作的组织成员、或者平台运营；哪些任务允许重试/取消；取消是否只停止尚未提交的工作；任务与结果保留多久。用户是否需要自定义计划任务不应由“任务中心”自动扩展出来。

BullMQ 当前提供基于 AbortSignal 的取消，且本机 5.81.5 类型定义已有 `cancelJob`；它是具体 Worker 实例对当前活动任务的操作，不自动提供 API → 独立 Worker、多副本协调或业务回滚。[官方取消说明](https://docs.bullmq.io/guide/workers/cancelling-jobs)。当前项目 processor 未接收或传递该 signal；若用户确认取消需求，需设计持久取消意图与 Worker 配合，不能让 HTTP 成功返回即宣称外部副作用已撤销。

### 外部发送边界

当前 `startTaskWorker` 把资源查权、`findCommitted` 和 `execute` 包在 `runInTenant` 内；`createTaskTenantRunner` 用数据库事务包住整个 callback。直接把 HTTP/SMTP 发送加入 `execute` 会在持有组织授权锁时等待外网，而且发送成功后数据库回滚不能撤回外部发送。[Worker](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/jobs/src/runtime.ts#L260)、[事务范围](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/task-tenant.ts#L40)。

如果通知/Webhook要求可靠提交，应在数据库事务中提交业务及投递意图，再以独立有界网络调用完成发送并记录尝试。发送成功但确认前崩溃可能重复投递；只有接收端按稳定 delivery/event ID 去重时，才能证明其业务消费不重复。本研究不把“exactly once外部发送”列为承诺。该结构是基于现有跨系统边界的推导，不是库提供的跨 PostgreSQL/Redis原子事务。

建议公开入口：固定任务类型注册、服务端提交、按当前授权读取任务/结果、获准重试/取消。复用现有真实 Worker 验证流程，增加业务事实与尝试结果分离、撤权后历史结果访问、SIGKILL后重取、提交确认丢失、双进程并发以及数据库意图已提交/Redis未入队的恢复。[现有测试入口说明](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/docs/guides/worker.md#L69)。

## 外部调用身份 / API Key

### 原生机制与当前身份管线的冲突

Better Auth API Key 是独立的 `@better-auth/api-key` 插件。官方提供创建、列表、更新、删除、权限验证及用户/组织归属能力。对应 `v1.7.5` 包源码存在，无需为密钥生成、哈希和基本生命周期重造认证子系统。[官方 API Key 文档](https://better-auth.com/docs/plugins/api-key)、[固定 v1.7.5 源码](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/api-key/src/index.ts)。当前仓库依赖尚未安装/注册该插件。[当前 package.json](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/package.json)、[当前插件清单](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/auth.ts#L1106)。

`enableSessionForAPIKeys` 默认关闭，仅用户 key 能模拟 Session；组织 key 没有单个关联用户。v1.7.5 源码将 mock session ID 设为 API Key ID，并不会产生项目要求的真实 `public.session` 行。因此启用它不能直接复用当前 `IdentityService`，更不能删掉现有 Cookie身份的数据库会话校验。[高级说明](https://better-auth.com/docs/plugins/api-key/advanced)、[v1.7.5 实现](https://github.com/better-auth/better-auth/blob/v1.7.5/packages/api-key/src/index.ts)、[项目当前身份](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/api/src/identity/identity.service.ts#L27)。

### 最少决策

需要用户确认：凭据代表用户还是组织；哪些 API/动作允许 key 调用；凭据是否随创建人的成员资格失效；哪些成员能签发、授权和撤销；有效期/轮换要求。组织 key 若要在 Worker中继续运行，必须明确 actor、权限与审计模型，因为当前 `TaskIdentity`/runner要求真实用户成员；不能填入创建人 ID 冒充永久服务身份。

建议实施时复用原生 key存储/验证，并在项目可信 principal入口中表达确定的调用主体、组织和权限，继续执行组织状态与资源范围约束。平台任职、用户安全设置等 Cookie/MFA敏感入口是否开放给 key必须显式授权，不能自动让所有认证路由可用。

建议公开入口：签发、一次性显示、列表、撤销、使用确定 key调用允许资源。测试失效/过期、跨组织、权限减少、创建人移除后的已确认规则、同一请求验证不重复扣限流、泄漏检查（日志/队列/审计不得包含 key）、Cookie Session原流程不被削弱。原生认证逻辑用正式HTTP和真实数据库验证，不 mock密码或 key哈希实现。

## Webhook

### 最少决策

需确认首版是向外发送领域事件、接收指定第三方回调，还是二者都要。出站必须确认事件目录、薄/完整载荷、谁能配置端点、可发送目标范围、签名规则、重试窗口、人工重放规则，以及组织停用/撤权后未投递事件如何处理。入站则必须指定真实 Provider和事件语义；不能实现一个任意 JSON回调入口便视为第三方集成完成。

Standard Webhooks给出了事件标识、时间戳及签名头、重放校验和接收端幂等约定，适合评估为首版协议；采用与否由具体方案确定，不需增加自创签名格式。[规范](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)。用户可配置回调 URL会带来服务器出站请求能力，目标网络限制应结合 Docker发行环境明确，不能仅校验URL字符串便宣称解决SSR​​F。[OWASP SSRF说明](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。

与通知共用可靠投递边界可减少重复基础设施，但两者的收件主体、重试及可见性仍由各自领域确定。不要把现有 `audit_events`全部直接发送为业务事件：审计含私有平台访问目的和敏感读取事实，具有与外部订阅不同的许可范围。[私有平台审计边界](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/README.md#L167)。

建议公开入口：端点配置、确定事件触发、投递记录、获准重放。出站用受控真实HTTP接收器验证准确签名原始字节、同一 event ID跨重试稳定、超时后未知结果、签名错误、端点停用、当前授权及组织隔离；入站使用选定Provider官方样例验证原始请求体验签、重复事件幂等及业务状态。替换网络transport适合单测，不替代实际HTTP投递验收。

## 用户安全中心

### 不应重造的原生入口

- 当前 `createWorkspaceAuthClient`已带 `twoFactorClient`；平台页面已调用 `twoFactor.enable`与 `verifyTotp`，可提取业务无关UI接入能力。[客户端](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/admin/src/auth/client.ts#L18)、[平台MFA页](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/apps/platform/src/App.tsx#L284)。
- Better Auth原生提供 `listSessions`、撤销指定Session、其他Session和全部Session；本机已安装1.7.5的 `dist/api/routes/session.d.mts`确认这些入口。[官方Session文档](https://better-auth.com/docs/concepts/session-management)。
- 原生 `changePassword`接受当前密码、新密码及 `revokeOtherSessions`；本机1.7.5 `update-user.d.mts`已确认。项目密码重置已设置 `revokeSessionsOnPasswordReset: true`。[官方密码API](https://better-auth.com/docs/authentication/email-password)、[当前设置](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/auth.ts#L788)。
- 原生 `changeEmail`默认关闭；开启后验证新邮箱，亦可配置先让旧邮箱确认。token生成/验证留给原生实现；只扩展对应durable邮件hook与页面。本机1.7.5 `update-user.mjs:438-518`确认这些分支，不需要单独自制邮箱变更token表。[官方User/Account文档](https://better-auth.com/docs/concepts/users-accounts)。
- 原生两步验证支持TOTP启停、生成/使用恢复码；本机1.7.5客户端与backup-codes模块确认这些接口。[官方2FA文档](https://better-auth.com/docs/plugins/2fa)。

### 需要保留的项目约束

平台权限依据“当前Session已成功TOTP验证”的assurance；恢复码成功登录或 `twoFactorEnabled=true`不能自动获得平台assurance。现有after hook只处理 `/two-factor/verify-totp`。安全中心不能改变该事实或降低平台授权强度。[当前hook](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/src/auth.ts#L974)、[既有MFA契约](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/README.md#L75)。

必须确认安全中心首版动作清单：密码、邮箱变更、会话列表/撤销、TOTP启停、恢复码；租户用户MFA是否自主启用或组织强制；平台任职用户能否自行停用MFA及如何恢复；邮箱变更采用新邮箱验证还是旧邮箱确认后再验证。账号删除、Passkey、设备指纹、风险评分不是“安全中心”自动包含的功能。

建议公开入口是上述原生API的实际浏览器流程。用两个真实Session验证撤销立即生效与当前Session行为；用真实Mailpit验证邮箱变更前后登录及旧链接/重复链接；用真实TOTP验证启停与恢复码一次性使用。关键回归是平台权限仍只接受当前Session TOTP、泄漏的Cookie快照不能在数据库Session删除后访问、错误密码/过期验证请求不改变身份事实。Storybook可模拟网络结果检查交互状态，但不替代真实认证验收。

## 依赖顺序与最少用户澄清

实施顺序建议先确认共同principal与权限/审计契约、任务持久操作事实及外部投递边界，再实现确定的导入/导出和业务通知/Webhook纵向流程；安全中心可并行，因为大部分依赖原生认证接口。每个新增表先确认身份域/租户域/平台域，按现有唯一迁移链生成并审查Schema、RLS及GRANT。最后在已确认的Docker Compose发行环境运行完整安装、升级、回退、备份恢复及跨能力业务验收。[迁移链](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/packages/database/README.md#L22)、[固定发布顺序](https://github.com/huanancaoo/enterprise-admin/blob/9880af6f40a0c9884305c27a1a5a5a717b253fe7/docs/guides/worker.md#L57)。

父任务可把以下五组不可推断规则汇成一次首版方案确认，而不逐个实现细节向用户提问：

1. **通知与Webhook**：一个确定的事件目录、接收人/端点配置主体、渠道、出站/入站方向及组织停用后的待发送规则。
2. **导入导出**：一个确定的资源/字段/格式、导入新增/更新及坏行原子性、导出筛选/快照/语言规则。
3. **任务**：谁能看/重试/取消、取消边界、保留期限；明确不让任务状态替代已提交业务事实。
4. **外部身份**：用户或组织key、允许动作、签发主体、创建人离组后的规则及Worker actor约束。
5. **安全中心**：具体动作清单、邮箱变更确认方式、租户MFA自主/强制、平台MFA停用与恢复规则。

行数/大小/保留期限、UI布局及固定库接入细节可在上述首版方案中给出明确建议，获得一次确认；不能在实现中默默加入改变业务语义的兼容/兜底分支。

## 研究边界

代码发现先使用codebase-memory-mcp的项目列表、符号与源码工具；范围与已引用源码通过覆盖检查。未记录索引缺口只是best-effort信号，不保证图完全；配置、文档和未索引的已安装依赖使用直接源码检索。Better Auth网页当日显示最新1.7.7，因此涉及当前行为同时核对本机1.7.5安装产物或官方v1.7.5源码；没有升级任何依赖。BullMQ取消API同时核对本机5.81.5类型定义。

没有运行测试，没有修改仓库、Git、生产配置或业务数据。公开测试入口均为实施建议，须在业务规则确认后按TDD通过用户可观察行为落地，不以内部mock或构建结果代替实际完整流程。
