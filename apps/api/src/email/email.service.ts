import type { EmailProvider } from './email-provider';
import { createDatabase } from '@workspace/database';
import type { AuthEmailHooks } from '@workspace/database/auth';
import { resolveEmailLocale } from '@workspace/i18n';
import type { EmailConfig } from './email-config';

type RuntimePool = ReturnType<typeof createDatabase>['pool'];
import {
  encryptEmailPayload,
  hashEmailUrl,
  hashRecipient,
} from './email-crypto';
import { assertAllowedEmailUrl } from './email-url';
import {
  EMAIL_TEMPLATE_VERSION,
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerifyEmail,
  type EmailTemplateKey,
} from './templates';

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type EnqueueInput = {
  organizationId: string | null;
  templateKey: EmailTemplateKey;
  requestedLocale: string | null | undefined;
  to: string;
  idempotencyKey: string;
  render: (locale: ReturnType<typeof resolveEmailLocale>) => {
    subject: string;
    html: string;
    text: string;
  };
  replaceOnConflict: boolean;
};

export class EmailService {
  constructor(
    private readonly pool: RuntimePool,
    private readonly config: EmailConfig,
    private readonly allowedOrigins: string[],
    private readonly provider: EmailProvider,
  ) {}

  hooks(): AuthEmailHooks {
    return {
      sendVerificationEmail: (data) => this.enqueueVerifyEmail(data),
      sendResetPassword: (data) => this.enqueuePasswordReset(data),
      sendInvitationEmail: (data) => this.sendInvitation(data),
    };
  }

  async enqueueVerifyEmail(data: {
    user: {
      id: string;
      email: string;
      name: string;
      preferredLocale?: string | null;
    };
    url: string;
  }): Promise<void> {
    const url = assertAllowedEmailUrl(data.url, this.allowedOrigins);
    await this.enqueue({
      organizationId: null,
      templateKey: 'verify-email',
      requestedLocale: data.user.preferredLocale,
      to: data.user.email,
      idempotencyKey: `auth.verify-email/${data.user.id}/${hashEmailUrl(url.href)}`,
      render: (locale) =>
        renderVerifyEmail(locale, {
          name: data.user.name,
          verifyUrl: url.href,
        }),
      replaceOnConflict: true,
    });
  }

  async enqueuePasswordReset(data: {
    user: {
      id: string;
      email: string;
      name: string;
      preferredLocale?: string | null;
    };
    url: string;
  }): Promise<void> {
    const url = assertAllowedEmailUrl(data.url, this.allowedOrigins);
    await this.enqueue({
      organizationId: null,
      templateKey: 'password-reset',
      requestedLocale: data.user.preferredLocale,
      to: data.user.email,
      idempotencyKey: `auth.reset-password/${data.user.id}/${hashEmailUrl(url.href)}`,
      render: (locale) =>
        renderPasswordResetEmail(locale, {
          name: data.user.name,
          resetUrl: url.href,
        }),
      replaceOnConflict: true,
    });
  }

  async sendInvitation(
    data: Parameters<AuthEmailHooks['sendInvitationEmail']>[0],
  ): Promise<void> {
    const acceptUrl = assertAllowedEmailUrl(
      `${this.config.linkOrigin}/accept-invitation/${data.invitation.id}`,
      this.allowedOrigins,
    );
    const recipient = await this.pool.query<{
      preferred_locale: string | null;
    }>(
      'SELECT preferred_locale FROM public."user" WHERE lower(email) = lower($1) LIMIT 1',
      [data.email],
    );
    const locale = resolveEmailLocale(
      recipient.rows[0]?.preferred_locale ?? data.organization.defaultLocale,
      this.config.defaultLocale,
    );
    const rendered = renderInvitationEmail(locale, {
      inviterName: data.inviter.user.name,
      organizationName: data.organization.name,
      acceptUrl: acceptUrl.href,
    });
    // 先记录“发送开始但结果未知”；进程中断也不能把已尝试的 SMTP 当成未发送。
    await this.pool.query(
      "UPDATE invitation_delivery_attempts SET status = 'unknown', started_at = clock_timestamp() WHERE id = $1",
      [data.attemptId],
    );
    let status = 'smtp_accepted';
    let errorCode: string | null = null;
    try {
      await this.provider.send({ to: data.email, ...rendered });
    } catch (error) {
      const failure = error as {
        code?: string;
        syscall?: string;
        responseCode?: number;
      };
      if (
        failure.syscall === 'connect' ||
        failure.code === 'ECONNREFUSED' ||
        failure.code === 'EDNS' ||
        failure.code === 'EAUTH' ||
        failure.code === 'EENVELOPE' ||
        failure.code === 'EMESSAGE' ||
        (failure.responseCode !== undefined &&
          failure.responseCode >= 400 &&
          failure.responseCode < 600)
      ) {
        status = 'failed';
        errorCode =
          failure.syscall === 'connect' ||
          failure.code === 'ECONNREFUSED' ||
          failure.code === 'EDNS'
            ? 'SMTP_CONNECTION_FAILED'
            : 'SMTP_REJECTED';
      } else {
        status = 'unknown';
        errorCode = 'SMTP_RESULT_UNKNOWN';
      }
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        data.organization.id,
      ]);
      // SMTP 结果与对应成功审计共同提交，审计仅保存状态和稳定错误码。
      await client.query(
        'UPDATE invitation_delivery_attempts SET status = $2, error_code = $3, completed_at = clock_timestamp() WHERE id = $1',
        [data.attemptId, status, errorCode],
      );
      await client.query(
        `INSERT INTO audit_events (organization_id, actor_id, event_code, resource_type, resource_id, request_id, tenant_visible, fields)
         VALUES ($1, $2, $3, 'invitation', $4, $5, true, $6::jsonb)`,
        [
          data.organization.id,
          data.actorId,
          `invitation.delivery_${status}`,
          data.invitation.id,
          data.requestId,
          JSON.stringify({ status, errorCode }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async enqueue(input: EnqueueInput): Promise<void> {
    const locale = resolveEmailLocale(
      input.requestedLocale,
      this.config.defaultLocale,
    );
    const rendered = input.render(locale);
    const payload: EmailPayload = {
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
    const ciphertext = encryptEmailPayload(
      JSON.stringify(payload),
      this.config.encryptionKey,
    );
    const values = [
      input.organizationId,
      input.templateKey,
      EMAIL_TEMPLATE_VERSION,
      locale,
      input.idempotencyKey,
      hashRecipient(input.to),
      ciphertext,
      new Date(Date.now() + this.config.messageTtlMs),
    ];
    const sql = `INSERT INTO email_messages (
           organization_id, type, template_key, template_version, locale, provider,
           idempotency_key, recipient_hash, payload_ciphertext, payload_key_id,
           status, attempt_count, next_attempt_at, expires_at
         ) VALUES (
           $1, 'auth', $2, $3, $4, 'smtp',
           $5, $6, $7, 'v1',
           'queued', 0, now(), $8
         )${input.replaceOnConflict ? ' ON CONFLICT (idempotency_key) DO NOTHING' : ''}`;
    await this.pool.query(sql, values);
  }
}
