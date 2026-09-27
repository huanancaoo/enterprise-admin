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
  ) {}

  hooks(): AuthEmailHooks {
    return {
      sendVerificationEmail: (data) => this.enqueueVerifyEmail(data),
      sendResetPassword: (data) => this.enqueuePasswordReset(data),
      sendInvitationEmail: (data) => this.enqueueInvitation(data),
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

  async enqueueInvitation(data: {
    email: string;
    organization: { id: string; name: string; defaultLocale?: string | null };
    invitation: { id: string };
    inviter: { user: { name: string } };
  }): Promise<void> {
    const acceptUrl = assertAllowedEmailUrl(
      `${this.config.linkOrigin}/accept-invitation/${data.invitation.id}`,
      this.allowedOrigins,
    );
    const version = await this.nextInvitationSendVersion(
      data.organization.id,
      data.invitation.id,
    );
    const recipient = await this.pool.query<{
      preferred_locale: string | null;
    }>(
      `SELECT preferred_locale FROM public."user" WHERE lower(email) = lower($1) LIMIT 1`,
      [data.email],
    );
    await this.enqueue({
      organizationId: data.organization.id,
      templateKey: 'organization.invitation',
      requestedLocale:
        recipient.rows[0]?.preferred_locale ?? data.organization.defaultLocale,
      to: data.email,
      idempotencyKey: `organization/${data.organization.id}/invitation/${data.invitation.id}/send/${version}`,
      render: (locale) =>
        renderInvitationEmail(locale, {
          inviterName: data.inviter.user.name,
          organizationName: data.organization.name,
          acceptUrl: acceptUrl.href,
        }),
      replaceOnConflict: false,
    });
  }

  private async nextInvitationSendVersion(
    organizationId: string,
    invitationId: string,
  ): Promise<number> {
    const prefix = `organization/${organizationId}/invitation/${invitationId}/send/`;
    const result = await this.pool.query<{ version: string }>(
      `SELECT COALESCE(MAX(split_part(idempotency_key, '/', 6)::int), 0) + 1 AS version
       FROM email_messages
       WHERE idempotency_key LIKE $1`,
      [`${prefix}%`],
    );
    return Number(result.rows[0].version);
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
    try {
      await this.pool.query(sql, values);
    } catch (error) {
      if (!input.replaceOnConflict && isUniqueViolation(error)) {
        const parts = input.idempotencyKey.split('/');
        parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
        await this.enqueue({ ...input, idempotencyKey: parts.join('/') });
        return;
      }
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}
