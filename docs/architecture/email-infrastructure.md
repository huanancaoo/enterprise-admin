# Email 基础设施

## 依据与范围

本文是用户提供的《Enterprise Admin Framework Email 基础能力 PRD 与 Technical Spec》的格式化归档。研究引用标记已去除，章节结构与原文一致。

该文档是归档研究。实施决策以用户确认的两周 Vertical Slice 和当前代码为准；精确配置以仓库为准。原文中的 SES、Resend、Webhook、Helm、metrics、`/email/send`、租户自带凭据、suppression、独立 `email_worker` 等建议不自动成为任务范围。

### 已锁定切片

日期：2026-09-18。用户确认只做两周认证邮件 Vertical Slice。

必须交付：

- SMTP Adapter 与本地 Mailpit
- PostgreSQL Durable Outbox
- 三封认证模板：`verify-email`、`password-reset`、`organization.invitation`
- Better Auth `sendVerificationEmail` / `sendResetPassword` / `sendInvitationEmail` 只做 durable enqueue
- 基础 retry 与幂等
- Mailpit 驱动的真实投递与浏览器验收

产品行为：

- `requireEmailVerification=true`；新注册必须验证后才能登录
- 平台管理员 CLI 创建用户时直接写 `emailVerified=true`，不入队
- 切片上线前已有用户迁移为 `email_verified = true`
- 租户后台落地页：验证邮箱、重置密码、接受邀请；成员页可发邀请
- 平台后台落地页：忘记密码、重置密码、已验证

实现约束（覆盖原文部分建议）：

- 认证在 `packages/database` 的 `createAuth` 中配置；EmailService 是 AuthRuntime 在 NestFactory 之前构造的普通类，不是 Nest `EmailModule`
- 领域实体是组织，列名 `organization_id`，不是 `tenant_id`
- `email_messages` 无 RLS，只 GRANT `app_runtime`；`organization_id` 可空、无外键
- 没有 `email_worker` 表或独立 worker 进程；dispatcher 在 `listen` 之后启动
- 模板为转义后的字符串 HTML，不使用 React Email
- 禁止 hook 内同步 SMTP 投递，禁止业务模块直连 Provider SDK

后文从原文 Executive Summary 起保留。

## Executive Summary

**PR 标题建议：`feat(email): 引入多租户 Email 基础设施并接入 Better Auth 邮箱验证、密码重置与组织邀请`。** 本 PR 建议把 Email 从“未来 Notification 可选能力”调整为 **v0.1 身份认证基础设施**：Better Auth 已提供邮箱验证、密码重置和 Organization Invitation 的 token/URL 生成及回调接口，其中验证邮件通过 `sendVerificationEmail`、密码重置通过 `sendResetPassword`、组织邀请通过 `sendInvitationEmail` 接入外部邮件系统；Better Auth 还明确建议不要等待真正的邮件发送完成，以降低 timing attack 风险。 因此，本项目应新增独立 `EmailModule`，由 Better Auth **负责身份 token 的生成和验证**，EmailModule 只负责模板渲染、持久化排队、Provider 投递、重试和投递状态；生产环境 v0.1 推荐使用 **PostgreSQL Durable Outbox** 作为无需 Redis 的可靠基线，同时提供 SMTP、Amazon SES、Resend Adapter，本地默认使用 Mailpit。BullMQ、租户自带 Provider Credentials、多 Provider 自动容灾、站内通知等放入 v0.2+。这既保证 Better Auth 的完整认证闭环，又避免为了三封认证邮件立即引入完整 Notification Platform。Better Auth 的默认 handler 可挂载到 `/api/auth/*`，其数据库、插件和服务端 API 均可由应用统一配置。

## PRD：背景、目标与范围

**GitHub Issue / Epic 标题**

```text
[Email Infrastructure] 为 Enterprise Admin Framework 增加基础邮件能力并完成 Better Auth 认证闭环
```

**背景**

当前 Enterprise Admin Framework 已确定以 NestJS + Better Auth + 多租户 Organization 为身份与租户基础。这里存在一个架构上的实际依赖：邮箱验证、Forgot Password / Reset Password、Organization Invitation 都需要真正的邮件投递通道，否则认证功能虽然有 API，却无法形成完整的用户闭环。Better Auth 的邮箱验证配置会把 `{ user, url, token }` 传给 `sendVerificationEmail`；密码重置会把 `{ user, url, token }` 传给 `sendResetPassword`；Organization 插件则暴露 `sendInvitationEmail` 用于发送邀请链接。

因此需要重新区分两个概念：

```text
Email Infrastructure
        │
        ├── 身份认证邮件
        ├── 模板
        ├── Provider
        ├── Retry
        ├── Delivery Tracking
        └── Webhook

               ≠

Notification Platform
        │
        ├── In-app Notification
        ├── SMS
        ├── Push
        ├── Digest
        ├── 用户通知偏好
        └── 复杂事件编排
```

前者是 **v0.1 基础设施**；后者仍然可以后置。

**产品目标**

本 Epic 完成后，系统必须能可靠完成以下核心流程：

1. 新注册用户可以收到邮箱验证邮件并完成验证。
2. 用户可以通过邮件安全地完成密码重置。
3. Organization Admin 可以邀请用户加入 Organization，被邀请用户可以从邮件完成接受邀请。
4. 邮件 Provider 暂时不可用时，认证数据不会因为一次 SMTP/API 故障而丢失发送机会。
5. SES/Resend 的 delivery、bounce、complaint 等事件可以被幂等处理。
6. 所有业务模块通过统一 `EmailService` 使用邮件，不直接依赖 Nodemailer、SES SDK 或 Resend SDK。

Better Auth 本身已有邮箱验证、重置密码及 Organization Invitation 的认证状态机，因此本项目**不重新实现 auth token**，只负责配送基础设施。密码重置官方流程是 `requestPasswordReset` 产生 URL/token，用户打开 URL 后把有效 token 带回 reset 页面，再调用 `resetPassword`；无效或过期 token 会进入 `INVALID_TOKEN` 流程。

**v0.1 必须实现**

| 能力                    | 要求                                 | 优先级 |
| ----------------------- | ------------------------------------ | ------ |
| EmailModule             | 独立 NestJS Module；Provider-neutral | P0     |
| EmailProvider Contract  | SMTP / SES / Resend 使用同一接口     | P0     |
| SMTP Adapter            | 支持标准 SMTP、STARTTLS/TLS          | P0     |
| SES Adapter             | AWS SDK Provider                     | P0     |
| Resend Adapter          | Resend API Provider                  | P0     |
| Mailpit                 | 本地 Compose 默认邮件服务器          | P0     |
| 邮箱验证                | Better Auth `sendVerificationEmail`  | P0     |
| 密码重置                | Better Auth `sendResetPassword`      | P0     |
| Organization Invitation | Better Auth `sendInvitationEmail`    | P0     |
| 模板                    | `zh-CN`、`en-US` 起步，可扩展 locale | P0     |
| Durable Outbox          | PostgreSQL 持久化排队                | P0     |
| Retry                   | 指数退避 + jitter + terminal failure | P0     |
| 幂等                    | 应用级 idempotency key               | P0     |
| Webhook                 | SES / Resend 投递事件归一化          | P0     |
| Suppression             | Permanent bounce / complaint 抑制    | P0     |
| 租户隔离                | 邮件元数据、设置受 tenant/RLS 约束   | P0     |
| Observability           | structured log、metrics、alert       | P0     |
| OpenAPI                 | 内部 `/email/send` 管理接口          | P0     |
| E2E                     | Mailpit 驱动的真实邮件测试           | P0     |
| Helm/Compose/Runbook    | 可直接部署与运维                     | P0     |

Mailpit 官方定位就是开发/测试邮件捕获服务器，提供 SMTP、Web UI、REST API，并支持测试异常场景，因此特别适合作为 E2E 基础设施。

**v0.2+ 可选能力**

| 能力                  | 说明                                |
| --------------------- | ----------------------------------- |
| BullMQ Worker         | Redis-backed 独立邮件 Worker        |
| Tenant BYO Provider   | 每个租户自己的 SES/SMTP/Resend 凭据 |
| Provider Failover     | SES → Resend 等受控故障切换         |
| Admin Template Editor | 数据库模板、版本审批、发布          |
| In-app Notification   | 通知中心                            |
| User Preferences      | email/in-app/SMS 通知偏好           |
| Digest                | Daily/Weekly digest                 |
| Marketing Email       | 与 transactional email 严格隔离     |
| Attachment            | 附件安全策略、大小限制、病毒扫描    |
| Tenant Custom Domain  | 租户自定义 From domain              |
| Delivery Dashboard    | Admin 投递/失败分析页面             |

Nest 官方当前建议新项目优先使用 BullMQ 而不是旧 Bull；`@nestjs/bullmq` 使用 Redis 持久化任务，支持 attempts、backoff、jobId、消费者和队列事件，因此非常适合作为后续独立 worker 的实现。

**明确不在 v0.1 范围**

v0.1 不建设营销邮件平台、不建设拖拽式模板编辑器、不实现短信、不实现 Push、不实现邮件列表订阅管理，也不允许租户提交任意 HTML 后调用系统发送。这些能力会显著增加滥发、合规和租户隔离面的复杂度。

**产品级验收指标建议**

这里定义的是本项目 SLO，不是 SES/Resend 对最终 Inbox 的保证：

| 指标                                 |      初始目标 |
| ------------------------------------ | ------------: |
| Email enqueue availability           | ≥ 99.95% / 月 |
| `queued → provider accepted` P95     |       < 30 秒 |
| `queued → provider accepted` P99     |      < 5 分钟 |
| Critical auth email dead-letter rate |        < 0.1% |
| Webhook persistence success          |      ≥ 99.99% |
| Webhook handler P95                  |        < 1 秒 |
| Tenant isolation E2E                 |     100% 通过 |
| Secret/token 被日志记录              |             0 |
| Duplicate webhook 导致重复状态转换   |             0 |

这里应使用“provider accepted”而不是“送达收件箱”作为系统 SLO。例如 SES 的 `Delivery` 事件意味着 SES 已经把邮件交给接收方邮件服务器，并不等同于最终进入用户 Inbox。

## PRD：关键用例与用户流程

Better Auth 默认可以挂载 `/api/auth/*` handler。以下路径按这一默认 base path 表达；Better Auth 原生响应字段应以当前锁定版本生成的 OpenAPI/Test snapshot 为准，以下 JSON 重点定义 Enterprise Admin 所依赖的**语义契约**，避免未来直接绑定 Better Auth 的内部返回结构。

**邮件发送总事件流**

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Tenant Admin
    participant UI as Admin UI
    participant BA as Better Auth
    participant ES as EmailService
    participant DB as PostgreSQL Email Outbox
    participant EW as Email Worker
    participant EP as SMTP / SES / Resend
    participant MB as Recipient Mailbox
    participant WH as Email Webhook

    User->>UI: 注册 / 重置密码 / 邀请成员
    UI->>BA: Better Auth API
    BA->>BA: 生成验证/重置/邀请状态
    BA->>ES: Email Hook(url, user/invitation)
    ES->>DB: INSERT queued message<br/>encrypted payload + idempotency key
    DB-->>ES: queued
    ES-->>BA: enqueue completed
    BA-->>UI: Auth API response

    EW->>DB: claim queued message
    EW->>EP: send()
    EP-->>EW: provider message id / accepted
    EW->>DB: accepted

    EP->>MB: SMTP delivery
    EP-->>WH: delivered / bounced / complained
    WH->>DB: dedupe + normalize event
    WH-->>EP: 2xx

    User->>MB: 打开邮件
    MB->>BA: Better Auth generated URL
    BA->>BA: 验证 token / invitation
    BA-->>UI: redirect / result
```

关键原则是 **Better Auth hook 可以等待“快速 durable enqueue”，但绝不等待 SMTP/API 真正投递完成**。Better Auth 官方特别提示不要等待邮件发送本身，以减少 timing attack 风险。

**邮箱验证**

调用序列：

```text
POST /api/auth/sign-up/email
        │
        ▼
Better Auth create user
        │
        ▼
emailVerification.sendVerificationEmail()
        │
        ▼
EmailService.enqueue(auth.verify-email)
        │
        ▼
PostgreSQL queued
        │
        ▼
Worker → Provider
        │
        ▼
用户点击 Better Auth 生成的 url
        │
        ▼
Better Auth verify token
        │
        ▼
emailVerified = true
```

Better Auth 官方支持 `sendVerificationEmail({ user, url, token })`，并可用 `sendOnSignUp` 在注册时触发邮件。

示例请求：

```http
POST /api/auth/sign-up/email
Content-Type: application/json

{
  "name": "张三",
  "email": "zhangsan@example.com",
  "password": "********",
  "callbackURL": "https://admin.example.com/auth/verified"
}
```

发送到 EmailModule 的内部 intent：

```json
{
  "type": "auth.verify-email",
  "tenantId": null,
  "recipient": "zhangsan@example.com",
  "locale": "zh-CN",
  "variables": {
    "userName": "张三",
    "verificationUrl": "<better-auth-generated-url>"
  },
  "idempotencyKey": "auth.verify-email/user_01J.../verification_01J..."
}
```

这里故意只传 `verificationUrl`，不要求模板直接拿独立 `token`。这可以减少 token 在系统内部的传播面。

成功后的 UI 语义：

```json
{
  "accepted": true,
  "message": "验证邮件已安排发送，请检查邮箱。"
}
```

错误及恢复：

| 场景                   | 对用户                              | 系统处理                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------ |
| SMTP/Provider 暂时 5xx | 不回滚用户                          | Outbox retry                               |
| 邮件发送超时           | 不重复立即发送                      | 标为 uncertain/retryable；使用 idempotency |
| 地址 permanent bounce  | 提示检查邮箱或修改邮箱              | suppression                                |
| token 过期             | “链接已过期”                        | 重新申请新的验证邮件                       |
| 用户重复点击           | 显示已验证/成功状态                 | token 验证应由 Better Auth 决定            |
| Outbox 不可写          | 返回服务暂时不可用或允许后续 resend | 告警；不能假装真正已排队                   |

**密码重置**

Better Auth 官方客户端提供 `requestPasswordReset({ email, redirectTo })`；有效链接会把 token 带到 reset 页面，无效或过期 token 会进入 `INVALID_TOKEN` 分支，随后客户端使用 `resetPassword({ newPassword, token })` 完成重置。

调用序列：

```text
POST /api/auth/request-password-reset
        │
        ▼
Better Auth 查找用户并生成 reset token
        │
        ▼
sendResetPassword({ user, url, token })
        │
        ▼
EmailService.enqueue(auth.password-reset)
        │
        ▼
Worker → Provider
        │
        ▼
用户点击 url
        │
        ▼
reset page ?token=...
        │
        ▼
POST /api/auth/reset-password
```

示例：

```http
POST /api/auth/request-password-reset
Content-Type: application/json

{
  "email": "zhangsan@example.com",
  "redirectTo": "https://admin.example.com/reset-password"
}
```

UI 必须采用**账号存在与不存在完全一致的文案**：

```json
{
  "accepted": true,
  "message": "如果该邮箱对应一个可用账号，我们将发送密码重置邮件。"
}
```

这是防止账号枚举的重要设计；同时真正的邮件发送不应被同步等待。Better Auth 也明确建议邮件发送异步化以降低时间差泄露。

本项目建议显式配置：

```ts
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  resetPasswordTokenExpiresIn: 3600,
  revokeSessionsOnPasswordReset: true,
}
```

Better Auth 当前文档提供 `resetPasswordTokenExpiresIn`，默认值为一小时，并提供 `revokeSessionsOnPasswordReset` 开关；本项目建议显式配置而不是依赖默认值。

错误恢复：

```text
TOKEN_EXPIRED
    └─> 不重用旧 token
        └─> 用户重新 request reset

PROVIDER_TEMPORARY_ERROR
    └─> 自动 retry
        └─> 超过 token 有效期则 mark expired
            └─> 用户重新 request reset

PERMANENT_BOUNCE
    └─> suppression
        └─> 不做无限重试
```

**Organization Invitation**

Better Auth Organization 插件支持邀请 API，并通过 `sendInvitationEmail` 将邀请数据交给应用发送。官方邀请 endpoint 支持 email、role、organizationId、`resend` 等信息；接受邀请时，登录用户邮箱需与邀请邮箱匹配。

示例请求：

```http
POST /api/auth/organization/invite-member
Content-Type: application/json
Cookie: better-auth.session_token=...

{
  "email": "new.member@example.com",
  "role": "member",
  "organizationId": "org_01J...",
  "resend": false
}
```

事件：

```text
organization.invitation.created
        │
        ▼
Better Auth sendInvitationEmail(data)
        │
        ▼
EmailService.enqueue(
    template = organization.invitation
)
        │
        ▼
new.member@example.com
```

邀请邮件：

```json
{
  "templateKey": "organization.invitation",
  "locale": "zh-CN",
  "variables": {
    "organizationName": "Acme",
    "inviterName": "Alice",
    "invitationUrl": "https://admin.example.com/accept-invitation/<id>"
  }
}
```

接受：

```http
POST /api/auth/organization/accept-invitation
Content-Type: application/json
Cookie: better-auth.session_token=...

{
  "invitationId": "inv_01J..."
}
```

Better Auth 的默认邀请有效期当前文档为 48 小时，并支持 `requireEmailVerificationOnInvitation`；Enterprise Admin 建议显式设置 48 小时且开启邀请邮箱验证要求。

对于“重新发送邀请”，不能一直使用同一个发送 idempotency key，否则用户主动 resend 可能被去重。建议：

```text
tenant/{organizationId}/invitation/{invitationId}/send/{sendVersion}
```

比如：

```text
tenant/org_123/invitation/inv_456/send/1
tenant/org_123/invitation/inv_456/send/2
```

这样网络层重试仍然去重，而管理员明确点击“重新发送”则产生新的 logical delivery。

**Provider Webhook / Callback 失败与重试**

这里必须区分三个“callback”：

```text
Better Auth email hook
    = 产生邮件发送意图

用户点击 auth callback URL
    = 验证 token / invitation

Email Provider webhook
    = delivered / bounce / complaint 状态通知
```

不要把三者混成一个机制。

Resend webhook 使用签名验证，验证时需要原始 request body；其官方文档还给出了用于去重的 webhook event ID。对于返回 5xx 的 webhook，Resend 会进行重试，并可在控制台 replay 事件。

建议 endpoint：

```http
POST /webhooks/email/resend
POST /webhooks/email/ses
```

处理流程：

```text
Provider
   │
   ▼
verify signature
   │
   ▼
INSERT email_provider_event
UNIQUE(provider, provider_event_id)
   │
   ├── duplicate → 204
   │
   ▼
COMMIT
   │
   ▼
204 No Content
   │
   ▼
async event processor
   │
   ├── delivered
   ├── bounced
   └── complained
```

关键是**先可靠落库、再快速返回 2xx**。业务状态更新失败时，由内部事件处理器重试，而不是要求 Provider 一直保持 HTTP request。

SES 能发布 delivery、bounce、complaint 等事件；对于 `Permanent` bounce，AWS 明确建议不要继续向该地址发送，而 `Transient` bounce 在 SES 已停止继续尝试后仍可能在未来重新成功。

## Technical Spec：模块、接口与 Better Auth 集成

**模块架构**

```mermaid
flowchart LR
    BA[Better Auth]
    TEN[Tenant / Organization]
    DOM[Domain Modules]

    EF[Email Facade / EmailService]
    TR[Template Registry]
    I18N[I18n Catalog]
    CFG[Email Config Resolver]

    DB[(PostgreSQL<br/>Email Message / Outbox)]
    WK[Email Dispatcher / Worker]

    PR[Provider Registry]
    SMTP[SMTP Adapter]
    SES[AWS SES Adapter]
    RS[Resend Adapter]

    WH[Webhook Controller]
    EN[Event Normalizer]
    SUP[Suppression Repository]

    BA --> EF
    TEN --> EF
    DOM --> EF

    EF --> CFG
    EF --> TR
    TR --> I18N
    EF --> DB

    WK --> DB
    WK --> PR
    PR --> SMTP
    PR --> SES
    PR --> RS

    SES --> WH
    RS --> WH
    WH --> EN
    EN --> DB
    EN --> SUP
```

NestJS 的 Module/DI 模型非常适合这里：`EmailModule` 暴露 `EmailService` 和 `EMAIL_PROVIDER` 抽象，调用方不依赖任何具体 Provider。Nest 官方也把 Module 作为功能边界，并通过 DI 注入 provider。

建议目录：

```text
apps/api/src/modules/email/
├── email.module.ts
├── email.service.ts
├── email.controller.ts
├── config/
│   ├── email.config.ts
│   └── email-config.resolver.ts
├── contracts/
│   ├── email-provider.ts
│   ├── email-intent.ts
│   └── email-event.ts
├── providers/
│   ├── smtp-email.provider.ts
│   ├── ses-email.provider.ts
│   └── resend-email.provider.ts
├── dispatcher/
│   ├── email-dispatcher.ts
│   ├── postgres-email-worker.ts
│   └── retry-policy.ts
├── templates/
│   ├── template-registry.ts
│   └── template-renderer.ts
├── webhooks/
│   ├── resend-webhook.controller.ts
│   ├── ses-webhook.controller.ts
│   └── email-event-normalizer.ts
└── repositories/
    ├── email-message.repository.ts
    ├── email-event.repository.ts
    └── email-suppression.repository.ts

packages/email-templates/
├── auth/
│   ├── verify-email/
│   └── password-reset/
├── organization/
│   └── invitation/
└── shared/
```

**核心 EmailProvider 接口**

这是整个设计最重要的稳定边界：

```ts
// packages/email/src/email-provider.ts

export type EmailProviderName = "smtp" | "ses" | "resend"

export interface EmailAddress {
  email: string
  name?: string
}

export interface EmailSendRequest {
  /**
   * Enterprise Admin 自己的 message id。
   * 不应使用 provider message id 作为业务主键。
   */
  messageId: string

  /**
   * 每一次 logical delivery 唯一。
   * 网络重试不得改变此 key。
   */
  idempotencyKey: string

  from: EmailAddress
  to: EmailAddress
  replyTo?: EmailAddress

  subject: string
  html: string
  text: string

  headers?: Record<string, string>
  tags?: Record<string, string>
}

export interface EmailSendResult {
  provider: EmailProviderName
  providerMessageId?: string
  acceptedAt: Date
  status: "accepted"
}

export interface EmailProviderHealth {
  ok: boolean
  message?: string
}

export interface EmailProvider {
  readonly name: EmailProviderName

  send(request: EmailSendRequest): Promise<EmailSendResult>

  verify?(): Promise<EmailProviderHealth>
}

export class EmailProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "EmailProviderError"
  }
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER")
```

设计要求是：

```text
EmailService
   │
   └── EmailProvider
          ├── SMTP
          ├── SES
          └── Resend
```

而不是：

```text
AuthService ─────> Resend SDK
ProjectService ──> Nodemailer
TenantService ───> SES SDK
```

**SMTP Adapter 示例**

Nodemailer 官方推荐创建并复用 transporter，而不是每封邮件新建连接；SMTP 587 一般通过 STARTTLS 工作，而 465 使用直接 TLS。

```ts
// smtp-email.provider.ts

import { Injectable, Logger } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import nodemailer, { Transporter } from "nodemailer"
import type {
  EmailProvider,
  EmailProviderHealth,
  EmailSendRequest,
  EmailSendResult,
} from "./email-provider"
import { EmailProviderError } from "./email-provider"

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp" as const

  private readonly logger = new Logger(SmtpEmailProvider.name)
  private readonly transporter: Transporter

  constructor(private readonly config: ConfigService) {
    const port = this.config.getOrThrow<number>("email.smtp.port")

    this.transporter = nodemailer.createTransport({
      host: this.config.getOrThrow<string>("email.smtp.host"),
      port,
      secure: port === 465,

      auth: this.config.get<string>("email.smtp.user")
        ? {
            user: this.config.getOrThrow<string>("email.smtp.user"),
            pass: this.config.getOrThrow<string>("email.smtp.password"),
          }
        : undefined,

      // 生产建议 true；Mailpit 本地环境通常设 false。
      requireTLS: this.config.get<boolean>("email.smtp.requireTls", false),

      pool: true,
      maxConnections: this.config.get<number>("email.smtp.maxConnections", 5),
    })
  }

  async verify(): Promise<EmailProviderHealth> {
    try {
      await this.transporter.verify()
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "SMTP verify failed",
      }
    }
  }

  async send(request: EmailSendRequest): Promise<EmailSendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.formatAddress(request.from),
        to: this.formatAddress(request.to),
        replyTo: request.replyTo
          ? this.formatAddress(request.replyTo)
          : undefined,
        subject: request.subject,
        html: request.html,
        text: request.text,
        headers: {
          ...request.headers,
          "X-Enterprise-Email-Id": request.messageId,
        },

        // 防止模板意外要求 Nodemailer 访问服务器本地文件或 URL。
        disableFileAccess: true,
        disableUrlAccess: true,
      })

      if (
        Array.isArray(info.rejected) &&
        info.rejected.includes(request.to.email)
      ) {
        throw new EmailProviderError(
          "SMTP recipient rejected",
          "SMTP_RECIPIENT_REJECTED",
          false
        )
      }

      return {
        provider: this.name,
        providerMessageId: info.messageId,
        acceptedAt: new Date(),
        status: "accepted",
      }
    } catch (error) {
      if (error instanceof EmailProviderError) {
        throw error
      }

      const smtpError = error as {
        code?: string
        responseCode?: number
        message?: string
      }

      const responseCode = smtpError.responseCode

      // SMTP 4xx 通常作为临时错误处理。
      const retryable =
        responseCode !== undefined
          ? responseCode >= 400 && responseCode < 500
          : ["ECONNECTION", "ETIMEDOUT", "ESOCKET"].includes(
              smtpError.code ?? ""
            )

      this.logger.warn(
        `SMTP send failed code=${smtpError.code ?? "unknown"} ` +
          `responseCode=${responseCode ?? "unknown"}`
      )

      throw new EmailProviderError(
        "SMTP send failed",
        smtpError.code ?? "SMTP_SEND_FAILED",
        retryable,
        undefined,
        { cause: error }
      )
    }
  }

  private formatAddress(address: { email: string; name?: string }): string {
    return address.name
      ? `"${address.name.replaceAll('"', "")}" <${address.email}>`
      : address.email
  }
}
```

这里日志故意不写 recipient、subject、HTML、verification URL 或 token。

**Provider Adapter 规范**

| 能力                      | SMTP               | SES            | Resend           |
| ------------------------- | ------------------ | -------------- | ---------------- |
| Transport                 | SMTP               | AWS API/SMTP   | HTTP API/SMTP    |
| v0.1 实现                 | 是                 | 是             | 是               |
| Provider Message ID       | 支持               | 支持           | 支持             |
| Delivery Webhook          | 取决于 SMTP 服务商 | SES Events/SNS | 原生 Webhooks    |
| Provider-side idempotency | Adapter 不假设     | Adapter 不假设 | 支持             |
| Bounce/Complaint          | 服务商相关         | 支持           | 支持             |
| 本地开发                  | Mailpit            | 不需要         | Test mode 可辅助 |
| Credentials               | Secret             | IAM/Secret     | API Key          |

Resend 当前明确支持 `Idempotency-Key`；相同 key 在 24 小时内重复调用时可以返回原结果而不重复发送，且 key 支持最多 256 字符。因此 `ResendEmailProvider` 应直接把 Enterprise Admin 的 `idempotencyKey` 传给 SDK。

SES 则应该通过 SES event publishing 统一转换为内部事件：

```text
SES Delivery     → email.delivered
SES Bounce       → email.bounced
SES Complaint    → email.complained
SES Reject       → email.rejected
```

SES 官方事件模型包含 Bounce、Complaint、Delivery、Reject 等信息。

**配置分层**

v0.1 强烈建议：

```text
Deployment-level
    │
    ├── provider
    ├── SMTP credentials
    ├── SES credentials / IAM
    ├── Resend API key
    ├── default FROM
    ├── queue settings
    └── webhook secrets

Tenant-level
    │
    ├── fromName
    ├── replyTo
    ├── defaultLocale
    ├── brandName
    ├── logoUrl
    └── theme metadata
```

**v0.1 不允许 Tenant 在数据库直接存自己的 Provider Secret。**

租户 BYO SMTP / API key 建议放 v0.2+，届时必须通过 KMS/Vault/Secrets Manager 做 envelope encryption，而不能简单在 `tenant_settings` 放明文。

建议 tenant 配置：

```ts
export interface TenantEmailSettings {
  tenantId: string

  defaultLocale: string

  brandName?: string
  fromName?: string
  replyTo?: string
  logoUrl?: string

  /**
   * v0.1 只能选择 Platform 已验证的 sender。
   */
  senderProfileId?: string
}
```

**模板策略**

v0.1 推荐 **Code-as-Template**，不是 DB HTML Editor：

```text
auth.verify-email
auth.password-reset
organization.invitation
system.test-email
```

每个模板：

```text
template
├── schema.ts
├── zh-CN.tsx
├── en-US.tsx
├── fixtures.ts
└── index.ts
```

变量必须经过 Zod schema：

```ts
const VerifyEmailVariables = z.object({
  userName: z.string().max(200),
  verificationUrl: z.string().url(),
  brandName: z.string().max(200),
})
```

模板渲染规则：

- 业务变量默认转义。
- 不允许 `rawHtml` 类型变量。
- URL 必须经过协议和 host allowlist。
- Template Key 必须是代码注册值，不接收客户端任意文件路径。
- Auth template 的 preview 一律使用假 token。
- Template version 写入每个 `email_message`，方便故障追踪。
- HTML 同时生成纯文本版本。

可以使用 React Email 实现 TS/React 模板；Resend 自己的官方页面也使用 React Email 展示模板开发模式，但 EmailModule 的接口不依赖 React Email，因此未来切换 MJML 等不会影响业务层。

建议 preview：

```http
GET /internal/email/templates/auth.verify-email/preview?locale=zh-CN
```

生产环境应默认关闭；若开启，仅 `platform:email:template:preview` 可以访问。

**数据库 Schema 草案**

建议不要持久化明文 token URL。Outbox 在不得不保存投递 payload 时，应加密 payload，并在消息进入 terminal state 后删除 ciphertext。

```sql
CREATE TABLE email_messages (
    id                  uuid PRIMARY KEY,
    tenant_id           uuid NULL,

    type                text NOT NULL,
    template_key        text NOT NULL,
    template_version    integer NOT NULL,
    locale              text NOT NULL,

    provider            text NOT NULL,

    -- 全局命名空间后的 logical delivery key。
    idempotency_key     text NOT NULL UNIQUE,

    recipient_hash      bytea NOT NULL,
    payload_ciphertext  bytea NOT NULL,
    payload_key_id      text NOT NULL,

    status              text NOT NULL
        CHECK (status IN (
            'queued',
            'sending',
            'retry',
            'accepted',
            'delivered',
            'bounced',
            'complained',
            'failed',
            'expired',
            'suppressed'
        )),

    attempt_count       integer NOT NULL DEFAULT 0,
    next_attempt_at     timestamptz NULL,

    provider_message_id text NULL,
    last_error_code     text NULL,

    expires_at          timestamptz NULL,
    accepted_at         timestamptz NULL,
    delivered_at        timestamptz NULL,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_messages_dispatch_idx
ON email_messages(status, next_attempt_at, created_at);

CREATE TABLE email_provider_events (
    id                  uuid PRIMARY KEY,
    tenant_id           uuid NULL,
    message_id          uuid NULL REFERENCES email_messages(id),

    provider            text NOT NULL,
    provider_event_id   text NOT NULL,
    event_type          text NOT NULL,

    payload_ciphertext  bytea NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    processed_at        timestamptz NULL,

    UNIQUE(provider, provider_event_id)
);

CREATE TABLE email_suppressions (
    id                  uuid PRIMARY KEY,
    tenant_id           uuid NULL,
    recipient_hash      bytea NOT NULL,
    reason              text NOT NULL,
    provider            text NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE(tenant_id, recipient_hash)
);

CREATE TABLE tenant_email_settings (
    tenant_id           uuid PRIMARY KEY,
    default_locale      text NOT NULL DEFAULT 'en-US',
    brand_name          text NULL,
    from_name           text NULL,
    reply_to            text NULL,
    logo_url            text NULL,
    sender_profile_id   text NULL,
    updated_at          timestamptz NOT NULL DEFAULT now()
);
```

对应 RLS 原则：

```text
tenant_id = current tenant
              │
              ├── email_messages
              ├── email_provider_events
              ├── email_suppressions
              └── tenant_email_settings
```

`tenant_id IS NULL` 的 platform/auth message 不应通过普通 tenant API 暴露。Worker 如需跨租户 dispatch，建议建立**独立最小权限 `email_worker` 数据库角色**，通过明确 policy 获得 email tables 的必要权限，而不是给 runtime role `BYPASSRLS`。

**Better Auth Adapter 注入**

最重要的规则：

> Better Auth 生成 token；EmailModule 绝不自行生成 Better Auth verification/reset token。

Better Auth 的 callback 已经把生成好的 URL/token 提供给应用，所以 EmailModule 只消费 URL。

NestJS factory 示例：

```ts
// auth.module.ts

import { Module } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import { EmailModule } from "../email/email.module"
import { EmailService } from "../email/email.service"
import { DATABASE } from "../../database/database.provider"

export const BETTER_AUTH = Symbol("BETTER_AUTH")

@Module({
  imports: [EmailModule],

  providers: [
    {
      provide: BETTER_AUTH,
      inject: [EmailService, ConfigService, DATABASE],

      useFactory: (
        emailService: EmailService,
        config: ConfigService,
        db: unknown
      ) => {
        const appUrl = config.getOrThrow<string>("APP_PUBLIC_URL")

        return betterAuth({
          database: drizzleAdapter(db as never, {
            provider: "pg",
          }),

          emailAndPassword: {
            enabled: true,

            // Enterprise Admin v0.1 要形成完整邮箱验证闭环。
            requireEmailVerification: true,

            resetPasswordTokenExpiresIn: 60 * 60,

            // 本项目安全策略：重置密码后注销旧 session。
            revokeSessionsOnPasswordReset: true,

            sendResetPassword: async ({ user, url }) => {
              // enqueue() 只做 durable DB enqueue。
              // 这里绝不等待真正 SMTP/HTTP provider 发送完成。
              await emailService.enqueue({
                type: "auth.password-reset",
                tenantId: null,
                recipient: {
                  email: user.email,
                  name: user.name,
                },
                templateKey: "auth.password-reset",
                locale: "zh-CN",
                variables: {
                  userName: user.name,
                  resetUrl: url,
                },
                expiresInSeconds: 60 * 60,
              })
            },
          },

          emailVerification: {
            sendOnSignUp: true,
            expiresIn: 60 * 60,

            sendVerificationEmail: async ({ user, url }) => {
              await emailService.enqueue({
                type: "auth.verify-email",
                tenantId: null,
                recipient: {
                  email: user.email,
                  name: user.name,
                },
                templateKey: "auth.verify-email",
                locale: "zh-CN",
                variables: {
                  userName: user.name,
                  verificationUrl: url,
                },
                expiresInSeconds: 60 * 60,
              })
            },
          },

          plugins: [
            organization({
              invitationExpiresIn: 60 * 60 * 48,

              requireEmailVerificationOnInvitation: true,

              sendInvitationEmail: async (data) => {
                const invitationUrl = `${appUrl}/accept-invitation/${data.id}`

                await emailService.enqueue({
                  type: "organization.invitation",
                  tenantId: data.organization.id,
                  recipient: {
                    email: data.email,
                  },
                  templateKey: "organization.invitation",
                  locale: "zh-CN",
                  variables: {
                    organizationName: data.organization.name,
                    invitationUrl,
                  },
                  expiresInSeconds: 60 * 60 * 48,
                })
              },
            }),
          ],
        })
      },
    },
  ],

  exports: [BETTER_AUTH],
})
export class AuthModule {}
```

Better Auth 官方文档的 `sendVerificationEmail` / `sendResetPassword` 回调即用于这种接法；Organization 插件同样提供 `sendInvitationEmail`。

这里 `await` 的是**本地 durable enqueue**，不是外部 SMTP/Resend/SES。即便如此，密码重置 API 仍应保持统一响应，不应通过错误内容和明显的延迟差泄露账户是否存在。

**内部 Email API**

通用 `/email/send` 不应该成为所有 tenant member 都能使用的 SMTP relay。它建议作为：

```text
Internal / Platform API
permission = platform:email:send
```

NestJS Controller：

```ts
import { Body, Controller, HttpCode, Post } from "@nestjs/common"

@Controller("email")
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Post("send")
  @HttpCode(202)
  // 实际项目增加：
  // @RequirePermission('platform:email:send')
  async send(
    @Body()
    input: {
      tenantId?: string
      to: string
      templateKey: string
      locale?: string
      variables: Record<string, unknown>
      idempotencyKey: string
    }
  ) {
    const result = await this.emailService.enqueue({
      type: "internal.template-send",
      tenantId: input.tenantId ?? null,
      recipient: { email: input.to },
      templateKey: input.templateKey,
      locale: input.locale ?? "zh-CN",
      variables: input.variables,
      idempotencyKey: input.idempotencyKey,
    })

    return {
      messageId: result.messageId,
      status: "queued",
    }
  }
}
```

Nest 官方 Swagger 模块可以从 Nest application 生成 OpenAPI 文档。

要求提交的 OpenAPI 片段：

```yaml
paths:
  /email/send:
    post:
      operationId: enqueueEmail
      summary: Enqueue a template-based email
      description: >
        Internal/platform endpoint. Does not accept arbitrary HTML.
        Requires platform:email:send permission.
      tags:
        - Email
      security:
        - bearerAuth: []
      x-internal: true

      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - to
                - templateKey
                - variables
                - idempotencyKey
              properties:
                tenantId:
                  type: string
                  format: uuid
                  nullable: true
                to:
                  type: string
                  format: email
                templateKey:
                  type: string
                  example: system.test-email
                locale:
                  type: string
                  example: zh-CN
                variables:
                  type: object
                  additionalProperties: true
                idempotencyKey:
                  type: string
                  minLength: 1
                  maxLength: 256

      responses:
        "202":
          description: Email has been queued
          content:
            application/json:
              schema:
                type: object
                required:
                  - messageId
                  - status
                properties:
                  messageId:
                    type: string
                    format: uuid
                  status:
                    type: string
                    enum:
                      - queued

        "400":
          description: Invalid request

        "403":
          description: Missing platform permission

        "409":
          description: Idempotency key conflicts with different payload

        "422":
          description: Template variables failed schema validation

        "429":
          description: Email send rate limit exceeded

        "503":
          description: Email queue is unavailable
```

## Technical Spec：可靠性、可观测性与安全合规

**生产默认可靠性模型**

推荐 v0.1：

```text
HTTP / Better Auth
        │
        │ enqueue
        ▼
PostgreSQL
email_messages
        │
        │ claim with
        │ FOR UPDATE SKIP LOCKED
        ▼
Email Dispatcher
        │
        ▼
Provider
```

这意味着 **Redis 在 v0.1 仍然不是强依赖**，但邮件发送已经具备 durable queue。

Worker 查询语义：

```sql
SELECT id
FROM email_messages
WHERE status IN ('queued', 'retry')
  AND (next_attempt_at IS NULL OR next_attempt_at <= now())
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

这样多副本 API/worker 可以并发 claim，而不会故意同时取得同一任务。

**状态机**

```text
queued
  │
  ▼
sending
  │
  ├───────────────┐
  ▼               ▼
accepted        retry
  │               │
  ▼               ├────> sending
delivered          │
                  ▼
                 failed

queued/retry
  │
  └────────────> expired

queued
  │
  └────────────> suppressed

accepted
  │
  ├──> bounced
  └──> complained
```

“accepted”与“delivered”必须区分。SES 的 delivery 事件是在 SES 已把消息交给目标邮件服务器后产生。

**重试分类**

| 错误                           | 策略                        |
| ------------------------------ | --------------------------- |
| TCP timeout / connection reset | retry                       |
| HTTP 408                       | retry                       |
| HTTP 429                       | respect Retry-After + retry |
| Provider 5xx                   | retry                       |
| SMTP 4xx                       | retry                       |
| SMTP 5xx recipient invalid     | terminal                    |
| Invalid API key                | pause provider + alert      |
| Sender/domain 未验证           | terminal/config alert       |
| Permanent bounce               | suppression                 |
| Complaint                      | suppression                 |
| Template validation failure    | terminal，不调用 Provider   |
| Auth token 已过期              | `expired`，禁止发送旧链接   |

初始退避建议：

```text
attempt 1 → immediately
attempt 2 → 10s + jitter
attempt 3 → 30s + jitter
attempt 4 → 2m + jitter
attempt 5 → 5m + jitter
attempt 6 → 15m + jitter
```

对于一小时有效的 reset/verify token，retry 必须被 `expires_at` 截断：

```text
nextAttempt >= expiresAt
        │
        └── mark expired
            不再发送
```

这比“隔两小时终于把已经失效的密码重置邮件发出去”更合理。

**幂等性**

应用级 key：

```text
auth.verify-email/{verification-event-id}

auth.password-reset/{reset-event-id}

tenant/{tenantId}/invitation/{invitationId}/send/{version}
```

数据库必须：

```sql
UNIQUE(idempotency_key)
```

对于 Resend，再把同一个 key 下传 Provider。Resend 当前会保存 idempotency key 24 小时，相同 key/相同请求可安全重试；如果同一 key 被不同 payload 使用，会返回冲突。

但不能把“application idempotency”宣传成绝对 exactly-once email。一个典型的不可确定场景是：

```text
Provider 实际接受邮件
        │
        X
HTTP response 在返回前网络断开
```

因此 Provider 不具备相同 idempotency 能力时，系统只能最大限度降低 duplicate，不能声称实现分布式 exactly-once。

**BullMQ 可选设计**

v0.2 可以把 Dispatcher 替换：

```text
EmailService
    │
    ▼
BullMQ producer
    │
    ▼
Redis
    │
    ▼
apps/worker
    │
    ▼
EmailProvider
```

Nest 官方 `@nestjs/bullmq` 支持 `attempts`、`backoff`、`jobId` 等任务配置；任务持久化于 Redis，多实例可以共同消费。

示意：

```ts
await emailQueue.add(
  "send",
  {
    messageId,
    // 不直接把明文 auth token 放 Redis。
    encryptedPayloadRef,
  },
  {
    jobId: idempotencyKey,
    attempts: 6,
    backoff: {
      type: "exponential",
      delay: 10_000,
    },
    removeOnComplete: 1_000,
    removeOnFail: 10_000,
  }
)
```

即使启用 BullMQ，建议 `email_messages` 仍然作为业务状态 source of truth，而 Redis 只是 execution queue。

**Webhook 幂等和恢复**

Resend 的 webhook 签名必须使用原始 request body 验证，且 provider event identifier 可用于重复事件去重。

处理原则：

```text
signature invalid
    → 401
    → 不落库

valid + duplicate
    → 204
    → 不重复更新

valid + new
    → transaction insert
    → 204
    → async process

event process failed
    → internal retry
```

Resend 对 webhook 的 5xx 会进行重试，官方文档说明其失败投递会在一定窗口内继续尝试，因此 endpoint 必须天生支持 duplicate。

**Suppression**

收到：

```text
Permanent Bounce
Complaint
```

则加入 suppression：

```text
recipientHash
tenantId
reason
timestamp
provider
```

下一次 enqueue 前：

```text
EmailService
    │
    ▼
SuppressionRepository.exists()
    │
    ├── yes → suppressed
    │
    └── no  → queued
```

AWS 明确区分 `Permanent` 和 `Transient` bounce，并建议 permanent bounce 地址不要继续投递。

**日志规范**

允许：

```json
{
  "event": "email.send.failed",
  "messageId": "em_...",
  "tenantId": "org_...",
  "templateKey": "auth.password-reset",
  "provider": "resend",
  "attempt": 3,
  "errorCode": "RATE_LIMITED",
  "retryable": true,
  "correlationId": "req_..."
}
```

禁止：

```text
password
auth token
verification URL
reset URL
full rendered HTML
SMTP password
API key
完整 recipient email
完整 provider webhook raw payload
```

Recipient 如果必须关联日志，可以记录：

```text
recipientHash = HMAC-SHA256(secret, normalizedEmail)
```

而不是普通 SHA-256；否则低熵邮箱容易被字典反查。

**Metrics**

建议：

```text
email_enqueue_total{type}
email_send_attempt_total{provider,outcome}
email_send_failure_total{provider,error_class}
email_queue_depth
email_oldest_job_age_seconds
email_delivery_latency_seconds
email_dead_letter_total
email_expired_total
email_suppressed_total{reason}
email_webhook_total{provider,event_type}
email_webhook_duplicate_total{provider}
```

不要：

```text
email_send_total{tenant_id="..."}
email_send_total{recipient="..."}
```

否则容易形成高 cardinality metrics；Tenant ID 留给日志/trace。

**告警初始值**

这些是建议的初始阈值，需要上线后按真实基线调整：

| 告警                       | 初始阈值                      |
| -------------------------- | ----------------------------- |
| oldest auth email          | > 2 分钟持续 5 分钟           |
| queue depth                | > 正常基线 5 倍               |
| provider failure rate      | > 5% / 10 分钟                |
| dead letter                | > 0 持续增加                  |
| provider auth/config error | 任意一次即告警                |
| webhook signature failure  | 突增                          |
| permanent bounce           | > 5% / 15 分钟                |
| complaint                  | > 0.1% / 小时，先作为内部预警 |

后两个数字是本项目的**可调初始告警阈值**，不是法律标准或 Provider SLA。

**防滥发和 Rate Limit**

Better Auth 自带客户端 endpoint 的 rate-limit 能力，但官方文档特别说明直接从服务器调用 `auth.api` 时不受客户端路由 limiter 的同样保护，因此应用自己的内部 endpoint 必须另做 rate limit。

建议策略：

| 行为                         |                      示例限制 |
| ---------------------------- | ----------------------------: |
| Password reset / email       |                      5 / 小时 |
| Password reset / IP          |                     20 / 小时 |
| Verification resend / email  |                      5 / 小时 |
| Verification resend / IP     |                     20 / 小时 |
| Organization invite / admin  |                  20 / 10 分钟 |
| Organization invite / tenant |                        配额制 |
| `/email/send`                | Platform-only + service quota |

高风险环境可以启用 Better Auth Captcha 插件；官方默认保护场景包含 email signup/signin 以及 password reset 请求等认证入口。

**Sender 安全**

v0.1 不允许请求指定任意：

```json
{
  "from": "ceo@bank.example"
}
```

正确设计是：

```text
senderProfileId
        │
        ▼
Server-side verified sender registry
        │
        ▼
verified From domain
```

生产发送域应配置 SPF、DKIM，并建议配置 DMARC；Resend 和 SES 都提供相应的域认证支持。

**模板注入防护**

禁止：

```ts
variables = {
  html: req.body.html,
}
```

推荐：

```text
typed variables
      │
      ▼
Zod validation
      │
      ▼
escaped renderer
      │
      ▼
fixed template
```

URL 类型变量额外检查：

```text
protocol ∈ {https}
host ∈ APP_ALLOWED_PUBLIC_HOSTS
```

防止攻击者利用企业域名发出：

```text
“点击这里重置密码”
        ↓
https://evil.example/...
```

**租户隔离**

邮件属于特殊的 tenant-bound operational data：

```text
Organization Invitation
        │
        └── tenant_id 必填

Project notification
        │
        └── tenant_id 必填

Platform auth verification
        │
        └── tenant_id = NULL
```

Tenant Admin 最多查看自己的 metadata：

```text
template
status
createdAt
deliveredAt
error category
```

默认不返回完整 HTML/body/token。

**GDPR / 隐私**

Email address、投递记录、IP、Provider event 都可能构成个人数据。GDPR Article 5 要求数据最小化、保存期限限制以及适当的完整性和保密性保护；因此“不加期限地保存每一封 reset password HTML”不是合理默认。

建议默认 retention：

| 数据                        |                              默认 |
| --------------------------- | --------------------------------: |
| Auth mail encrypted payload |          发送 terminal 后立即清除 |
| 未完成 outbox payload       |     最多 token TTL / retry window |
| Email metadata              |                             90 天 |
| Webhook normalized metadata |                             90 天 |
| Raw encrypted webhook       |               7–30 天，按排障需求 |
| Suppression hash            | 保留至解除 suppression / 法务策略 |
| Audit security event        |   使用现有 Audit retention policy |

这些期限是产品默认建议，不是直接宣称为 GDPR 法定期限；最终应由公司的 DPO/法务和实际业务目的确认。GDPR 原文来源： [EUR-Lex Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)。

## 部署运维、容量成本与迁移

**环境变量**

建议 `.env.example`：

```dotenv
# Core
EMAIL_ENABLED=true
EMAIL_PROVIDER=smtp
EMAIL_DEFAULT_LOCALE=zh-CN

EMAIL_FROM_ADDRESS=no-reply@example.com
EMAIL_FROM_NAME="Enterprise Admin"
EMAIL_REPLY_TO=support@example.com

# Dispatch
EMAIL_DISPATCH_MODE=postgres
EMAIL_MAX_ATTEMPTS=6
EMAIL_RETRY_BASE_MS=10000
EMAIL_WORKER_BATCH_SIZE=50
EMAIL_WORKER_POLL_INTERVAL_MS=1000

# Sensitive outbox payload encryption
EMAIL_PAYLOAD_ENCRYPTION_KEY_ID=email-payload-v1
EMAIL_PAYLOAD_ENCRYPTION_KEY=CHANGE_ME

# SMTP
EMAIL_SMTP_HOST=localhost
EMAIL_SMTP_PORT=1025
EMAIL_SMTP_USER=
EMAIL_SMTP_PASSWORD=
EMAIL_SMTP_REQUIRE_TLS=false
EMAIL_SMTP_MAX_CONNECTIONS=5

# AWS SES
EMAIL_SES_REGION=us-east-1
# Prefer workload identity in production.
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Resend
EMAIL_RESEND_API_KEY=
EMAIL_RESEND_WEBHOOK_SECRET=

# Better Auth / public URLs
BETTER_AUTH_URL=http://localhost:3000
APP_PUBLIC_URL=http://localhost:5173

EMAIL_VERIFICATION_TTL_SECONDS=3600
EMAIL_PASSWORD_RESET_TTL_SECONDS=3600
EMAIL_INVITATION_TTL_SECONDS=172800

# Webhook
EMAIL_WEBHOOK_ENABLED=true

# Optional BullMQ
EMAIL_QUEUE_DRIVER=postgres
REDIS_URL=redis://localhost:6379
```

NestJS 官方 Config 模块就是为 environment/configuration 管理设计的，因此建议所有 email config 进入一个 typed `registerAs('email', ...)` 配置域，而不是散落读取 `process.env`。

**Secrets**

生产禁止：

```yaml
env:
  - name: EMAIL_RESEND_API_KEY
    value: "re_xxxxxx"
```

也禁止把 credential 写入：

```text
values.yaml
.env.production
GitHub repository
tenant_settings
```

推荐：

```text
AWS Secrets Manager / Vault / 云 Secret Store
                 │
                 ▼
Kubernetes Secret / workload identity
                 │
                 ▼
Container
```

SES 在 AWS 环境优先使用 workload identity / IAM role；Resend 和传统 SMTP password 则作为 secret 注入。

**Docker Compose 本地开发**

Mailpit 官方提供 Docker 部署，适合作为本地 SMTP 捕获器。

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: enterprise_admin
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"

  mailpit:
    image: axllent/mailpit
    restart: unless-stopped
    ports:
      # SMTP
      - "1025:1025"
      # Web UI / HTTP API
      - "8025:8025"

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    depends_on:
      - postgres
      - mailpit
    environment:
      EMAIL_ENABLED: "true"
      EMAIL_PROVIDER: "smtp"
      EMAIL_DISPATCH_MODE: "postgres"

      EMAIL_SMTP_HOST: "mailpit"
      EMAIL_SMTP_PORT: "1025"
      EMAIL_SMTP_REQUIRE_TLS: "false"

      EMAIL_FROM_ADDRESS: "no-reply@local.test"
      EMAIL_FROM_NAME: "Enterprise Admin Local"

      DATABASE_URL: "postgres://postgres:postgres@postgres:5432/enterprise_admin"
```

浏览：

```text
http://localhost:8025
```

即可检查实际发送出的 verify/reset/invitation 邮件。Mailpit 还提供 REST API，可用于 E2E 自动查找邮件，而不应在测试里 mock `EmailService`。

MailHog 可以保留兼容说明，但新项目建议默认 Mailpit；MailHog 仍有常见的 SMTP 1025 / Web UI 8025 Docker 使用模式。

**Helm values 示例**

```yaml
email:
  enabled: true
  provider: ses
  dispatchMode: postgres

  from:
    address: no-reply@example.com
    name: Enterprise Admin
    replyTo: support@example.com

  defaultLocale: zh-CN

  worker:
    batchSize: 50
    pollIntervalMs: 1000
    maxAttempts: 6

  ses:
    region: us-east-1

  secrets:
    existingSecret: enterprise-admin-email
```

Deployment：

```yaml
env:
  - name: EMAIL_ENABLED
    value: { { .Values.email.enabled | quote } }

  - name: EMAIL_PROVIDER
    value: { { .Values.email.provider | quote } }

  - name: EMAIL_DISPATCH_MODE
    value: { { .Values.email.dispatchMode | quote } }

  - name: EMAIL_FROM_ADDRESS
    value: { { .Values.email.from.address | quote } }

  - name: EMAIL_FROM_NAME
    value: { { .Values.email.from.name | quote } }

  - name: EMAIL_DEFAULT_LOCALE
    value: { { .Values.email.defaultLocale | quote } }

  - name: EMAIL_SES_REGION
    value: { { .Values.email.ses.region | quote } }

  - name: EMAIL_RESEND_API_KEY
    valueFrom:
      secretKeyRef:
        name: { { .Values.email.secrets.existingSecret } }
        key: resend-api-key

  - name: EMAIL_PAYLOAD_ENCRYPTION_KEY
    valueFrom:
      secretKeyRef:
        name: { { .Values.email.secrets.existingSecret } }
        key: payload-encryption-key
```

对于 SES + EKS，实际生产 chart 可不注入 static AWS key，而由 Pod 的 workload identity/IAM 负责授权。

**生产 Provider 上线检查**

SMTP：

```text
[ ] TLS/STARTTLS
[ ] sender verified
[ ] connection verify
[ ] send test
[ ] bounce path documented
```

SES：

```text
[ ] sending identity verified
[ ] DKIM configured
[ ] production access granted
[ ] sending quota checked
[ ] configuration/event destination configured
[ ] bounce/complaint handling verified
```

SES Sandbox 当前只允许约 200 封/24 小时、最高约 1 封/秒，并且生产发送需要申请离开 Sandbox；正式账户的日发送量与每秒发送率是 Region-specific quota。

Resend：

```text
[ ] domain verified
[ ] API key stored in Secret Store
[ ] webhook signing secret configured
[ ] delivery/bounce/complaint subscribed
[ ] test mode verified
[ ] idempotency key forwarded
```

Resend API 当前默认存在每 team API rate limit，官方 Usage Limits 文档给出的默认值为 10 requests/sec；较大业务量需要申请提高限制或采用相应企业方案。

**迁移步骤**

建议按以下顺序上线，而不是直接打开 `requireEmailVerification`：

```text
Deploy A
    │
    ├── DB migration
    ├── EmailModule
    ├── Mailpit/Staging Provider
    └── EMAIL_ENABLED=false production

Deploy B
    │
    ├── Provider credentials
    ├── domain SPF/DKIM
    ├── health check
    └── production test emails

Deploy C
    │
    ├── Email hooks enabled
    ├── requireEmailVerification temporarily false
    └── observe send/bounce/queue metrics

Deploy D
    │
    ├── verification E2E confirmed
    ├── password reset confirmed
    ├── invitation confirmed
    └── requireEmailVerification=true
```

这里尤其要处理**历史用户**。如果现有 user 表已经有未验证账号，不能毫无策略地打开 `requireEmailVerification=true`，否则可能让现有用户突然无法登录。

必须先决定：

```text
可信历史用户
   └── migration 标记 verified

或

历史用户
   └── grace-period re-verification
```

不能简单把所有历史用户都无条件标为 verified，也不能不评估就一次性锁死。

**回滚**

DB migration 建议 forward-compatible：

```text
新增表
新增索引
新增配置
```

不要让 rollback 依赖立即 DROP TABLE。

紧急回退：

```text
EMAIL_ENABLED=false
        │
        ├── 停止新发送
        └── 保留 queued messages

requireEmailVerification=false
        │
        └── 避免认证完全不可用

Organization invitation
        │
        └── UI 暂停邀请或提供 resend

Provider switch
        │
        └── SMTP / SES / Resend
```

已进入 `accepted` 的邮件不能因为系统 rollback 而假定“没有发送”。

**无队列退化方案**

如果用户部署时明确选择：

```dotenv
EMAIL_DISPATCH_MODE=inline
```

则：

```text
Better Auth Hook
      │
      ▼
in-process background send
```

这种模式可以用于：

```text
local
demo
single-node small deployment
```

但不建议作为 Enterprise production 默认。

主要风险：

```text
API process crashes
       ↓
background promise 丢失
       ↓
email never sent
```

恢复只能依赖：

```text
Resend Verification
Request Password Reset Again
Resend Invitation
```

因此正式 v0.1 推荐 Postgres Outbox，而不是要求 Redis/BullMQ。

**规模假设**

由于租户数、邮件量和预算均未指定，本 PR 使用三种 planning profile：

| 规模 | 假设租户数 |   月发送量 |     日均 | 平均发送率 | 设计峰值 |
| ---- | ---------: | ---------: | -------: | ---------: | -------: |
| 小   |         10 |     20,000 |     ~667 |   ~0.008/s |      1/s |
| 中   |        200 |    500,000 |  ~16,667 |    ~0.19/s |     20/s |
| 大   |      2,000 | 10,000,000 | ~333,333 |    ~3.86/s |    200/s |

峰值并非从平均值直接推导，而是为登录、批量邀请、事故后补发等 burst 人为预留的容量假设。

建议 Worker：

| 规模 | Worker | 单 Worker concurrency | 说明                    |
| ---- | -----: | --------------------: | ----------------------- |
| 小   |      1 |                     5 | Postgres Worker 足够    |
| 中   |      2 |                 10–20 | Provider quota 限速     |
| 大   |   5–10 |                 20–50 | 建议 BullMQ/专用 worker |

大规模下真正的上限主要由 Provider rate/quota 决定。SES 明确有每日和每秒发送 quota；Resend 默认 API limit 也需要在高吞吐场景提升。

**成本估算**

以下价格基于 **2026 年 9 月 17 日**可见的 Provider 官方公开价格，只用于架构预算，实际采购前必须再次确认。

AWS SES 当前价格页面列出了按发送量计费的方案，并仍提供 à-la-carte 模式；基础 outbound à-la-carte 发送价格约为 `$0.10 / 1,000 emails`，当前 SES Essentials 档在前一千万封范围约 `$0.16 / 1,000 emails`。AWS 还对 attachment/data、dedicated IP 等项目另计费用。
官方链接：[Amazon SES Pricing](https://aws.amazon.com/ses/pricing/)

Resend 当前公开价格中，Free 为 3,000 emails/月并有日限额；Pro 为 `$20/月`含 50,000 封，额外邮件 `$0.90/1,000`；Scale 为 `$90/月`含 100,000 封，额外部分同样按公开阶梯计费，Enterprise 为定制报价。
官方链接：[Resend Pricing](https://resend.com/pricing)

按上述 volume 粗算：

| 规模 | 月邮件 | SES à-la-carte | SES Essentials 量级 |                  Resend 公示价示例 |
| ---- | -----: | -------------: | ------------------: | ---------------------------------: |
| 小   |    20k |            ~$2 |              ~$3.20 |                           ~$20 Pro |
| 中   |   500k |           ~$50 |                ~$80 |                              ~$425 |
| 大   |    10M |        ~$1,000 |             ~$1,600 | ~$8,975 左右，建议 Enterprise 报价 |

Resend 大规模数字是用 Pro 公示的 `$20 + 超出 50k × $0.90/1k` 做预算线性估算，并不意味着这是十百万封/月最佳商业方案；到这一规模应该取得 Enterprise quotation。

SES 费用也**未包含**：

```text
attachments/data
dedicated IP
support
tax
跨区域等额外服务
```

因此 Provider 选择不能只比较：

```text
$ / 1000 emails
```

还要比较：

```text
开发成本
运维成本
deliverability 排障
webhook/debug UX
供应商锁定
AWS 基础设施整合程度
```

**建议 Provider 决策**

```text
团队已经重度 AWS
        │
        └── SES 优先

希望 DX 简单、上线快
        │
        └── Resend 优先

已有企业 SMTP
        │
        └── SMTP Adapter

本地开发
        │
        └── Mailpit
```

不要自建互联网邮件服务器作为默认方案。所谓“自建 SMTP”如果意味着自己维护公网 MTA，还会增加 IP reputation、反垃圾、DNS、bounce、complaint 和 deliverability 运维成本；对 Enterprise Admin Framework 而言，Provider Adapter + 托管投递通常是更合适的边界。

## 交付计划、风险、验收与责任表

**建议迭代节奏**

**两周里程碑：认证邮件 Vertical Slice**

范围：

```text
EmailProvider contract
SMTP Adapter
Mailpit
模板框架
Postgres Email Outbox
verify email
password reset
organization invitation
基础 retry
基础 E2E
```

验收：

```text
[ ] docker compose up 后 Mailpit 可直接使用
[ ] signup 后 Mailpit 收到 verify email
[ ] 点击 verify URL 可完成邮箱验证
[ ] request password reset 后收到 reset email
[ ] reset token 可以成功修改密码
[ ] Organization Admin 可发 invitation
[ ] 被邀请用户可以接受 invitation
[ ] SMTP down 后 message 留在 retry 状态
[ ] 恢复 SMTP 后可以补发
[ ] tenant A 无法读 tenant B 邮件数据
[ ] token / URL / password 不出现在日志
```

**四周里程碑：生产可用 v0.1**

在两周基础上增加：

```text
SES Adapter
Resend Adapter
Resend Webhook
SES Event handling
Suppression
幂等性
structured metrics
alerts
OpenAPI
Helm
Runbook
security/rate limits
migration/rollback tests
```

验收：

```text
[ ] EMAIL_PROVIDER=smtp|ses|resend 不改调用方代码
[ ] Resend idempotency key 被透传
[ ] duplicate webhook 被 UNIQUE key 安全去重
[ ] permanent bounce 会进入 suppression
[ ] complaint 会进入 suppression
[ ] retry 不会在 auth token 已失效后继续投递
[ ] Provider credential 不存在数据库明文
[ ] Helm production deployment 验证
[ ] SMTP/SES/Resend 各至少一个 integration test
[ ] OpenAPI snapshot 纳入 CI
[ ] runbook 包含 queue backlog / provider outage / bounce incident
```

Resend 的 Provider-side idempotency 可以作为额外保障，但应用本身的 database idempotency 仍然必须存在。

**八周里程碑：平台化增强**

候选：

```text
BullMQ + apps/worker
Tenant branding UI
Template preview UI
Provider health/circuit breaker
manual replay
email operational dashboard
load test
provider failover ADR
tenant provider override PoC
```

验收：

```text
[ ] API 与 Worker 可以独立扩容
[ ] Redis/BullMQ outage 有 runbook
[ ] queue lag 可以监控和告警
[ ] worker restart 后未完成 job 可以继续执行
[ ] provider failover 不在 ambiguous-send 状态下自动切换
[ ] 中规模 profile 20 msg/s burst load test 通过
[ ] 大规模 profile 有明确 quota increase / capacity plan
```

Nest 官方指出 BullMQ/Bull 队列可以持久化 job 状态，在 producer/consumer 故障后继续处理，并能把 worker 横向扩展到多个进程或节点。

**主要风险与决策**

| 风险                                     | 后果                              | 建议                                       |
| ---------------------------------------- | --------------------------------- | ------------------------------------------ |
| Better Auth hook 直接 await Provider     | auth latency、timing side channel | 只 durable enqueue，不 await external send |
| 完全 fire-and-forget                     | process crash 后丢邮件            | Postgres Outbox                            |
| 重试没有 idempotency                     | 重复邮件                          | DB unique key + Provider key               |
| token 排队超过 TTL                       | 用户收到无效邮件                  | message `expires_at`                       |
| 自动跨 Provider failover                 | ambiguous send 导致重复           | 只在明确未发送状态 failover                |
| arbitrary HTML API                       | phishing/template injection       | code template + schema                     |
| arbitrary From                           | 域名伪造、reputation 风险         | verified sender registry                   |
| tenant secrets 明文 DB                   | credential breach                 | v0.1 禁止；v0.2 KMS                        |
| Webhook 未签名验证                       | forged delivery/bounce            | signature first                            |
| Webhook 无去重                           | 状态错乱                          | provider_event_id UNIQUE                   |
| Permanent bounce 无限 retry              | reputation/成本问题               | suppression                                |
| 将 delivery 等同 inbox                   | 错误 SLA                          | SLO 只到 provider/server acceptance        |
| 开启 require verification 前未迁移旧用户 | 老用户无法登录                    | staged rollout                             |
| 自建公网 SMTP                            | 高运维/deliverability 成本        | 默认 SES/Resend/企业 SMTP                  |

**最终 PR 验收标准**

PR 可以合并的最低条件：

```text
Functional
[ ] verify email
[ ] password reset
[ ] organization invitation
[ ] resend invitation
[ ] template locale fallback

Architecture
[ ] EmailProvider abstraction
[ ] no provider SDK outside EmailModule
[ ] durable production queue
[ ] provider switch by config

Reliability
[ ] retries
[ ] idempotency
[ ] expiry
[ ] dead-letter/failed state
[ ] webhook dedupe
[ ] suppression

Security
[ ] rate limits
[ ] no raw arbitrary HTML
[ ] no arbitrary sender
[ ] tokens excluded from logs
[ ] encrypted queued payload
[ ] tenant RLS E2E
[ ] webhook signature verification

Operations
[ ] metrics
[ ] alerts
[ ] health check
[ ] migration
[ ] rollback
[ ] Compose
[ ] Helm
[ ] Runbook

Testing
[ ] unit tests
[ ] integration tests
[ ] Mailpit E2E
[ ] tenant isolation tests
[ ] retry tests
[ ] duplicate event tests
[ ] provider outage tests
```

Better Auth 官方依据： [Email](https://better-auth.com/docs/concepts/email)、[Email & Password](https://better-auth.com/docs/authentication/email-password)、[Organization](https://better-auth.com/docs/plugins/organization)。邮箱验证、重置密码和 Organization Invitation 的 callback 设计均直接建立在这些官方能力之上。

| 交付物                                         | 负责人假定 | 估时（人日） | 优先级     |
| ---------------------------------------------- | ---------- | -----------: | ---------- |
| PRD / ADR / Email 架构冻结                     | 未指定     |          1.5 | P0         |
| EmailModule、配置模型、DI 边界                 | 未指定     |            2 | P0         |
| `EmailProvider` TypeScript Contract            | 未指定     |            1 | P0         |
| SMTP Adapter + Mailpit Compose                 | 未指定     |            2 | P0         |
| Email Templates、i18n、变量 Schema、Preview    | 未指定     |            3 | P0         |
| Better Auth 邮箱验证集成                       | 未指定     |            2 | P0         |
| Better Auth Password Reset 集成                | 未指定     |            2 | P0         |
| Better Auth Organization Invitation 集成       | 未指定     |            2 | P0         |
| PostgreSQL Email Outbox / Dispatcher           | 未指定     |            4 | P0         |
| Email DB Schema、Migration、RLS                | 未指定     |            3 | P0         |
| Retry、Expiry、Idempotency、Dead-letter        | 未指定     |            3 | P0         |
| Resend Adapter + Webhook + Signature           | 未指定     |          2.5 | P0         |
| SES Adapter + Delivery/Bounce/Complaint Events | 未指定     |            3 | P0         |
| Suppression Management                         | 未指定     |          1.5 | P0         |
| `/email/send` API + OpenAPI Spec               | 未指定     |          1.5 | P0         |
| Rate Limit、Anti-abuse、Security Hardening     | 未指定     |          2.5 | P0         |
| Logging、Metrics、Alert Rules                  | 未指定     |            2 | P0         |
| Unit / Integration / Mailpit E2E               | 未指定     |            4 | P0         |
| Tenant Isolation / RLS E2E                     | 未指定     |          1.5 | P0         |
| Helm、Secrets、Production Config               | 未指定     |            2 | P0         |
| Migration / Rollback / Operational Runbook     | 未指定     |            2 | P0         |
| Capacity / Provider Quota / Cost Validation    | 未指定     |            1 | P1         |
| BullMQ + Dedicated Worker                      | 未指定     |            3 | P1 / v0.2+ |
| Tenant BYO Provider Credentials                | 未指定     |            4 | P2 / v0.2+ |
| Template Admin UI / Delivery Dashboard         | 未指定     |            5 | P2 / v0.2+ |
