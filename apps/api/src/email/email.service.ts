import { createDatabase } from '@workspace/database';
import type { AuthEmailHooks } from '@workspace/database/auth';
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
  resolveEmailLocale,
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
  locale: string | null | undefined;
  to: string;
  idempotencyKey: string;
  rendered: { subject: string; html: string; text: string };
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
    const locale = resolveEmailLocale(
      data.user.preferredLocale,
      this.config.defaultLocale,
    );
    await this.enqueue({
      organizationId: null,
      templateKey: 'verify-email',
      locale: data.user.preferredLocale,
      to: data.user.email,
      idempotencyKey: `auth.verify-email/${data.user.id}/${hashEmailUrl(url.href)}`,
      rendered: renderVerifyEmail(locale, {
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
    const locale = resolveEmailLocale(
      data.user.preferredLocale,
      this.config.defaultLocale,
    );
    await this.enqueue({
      organizationId: null,
      templateKey: 'password-reset',
      locale: data.user.preferredLocale,
      to: data.user.email,
      idempotencyKey: `auth.reset-password/${data.user.id}/${hashEmailUrl(url.href)}`,
      rendered: renderPasswordResetEmail(locale, {
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
    const locale = resolveEmailLocale(
      data.organization.defaultLocale,
      this.config.defaultLocale,
    );
    const version = await this.nextInvitationSendVersion(
      data.organization.id,
      data.invitation.id,
    );
    await this.enqueue({
      organizationId: data.organization.id,
      templateKey: 'organization.invitation',
      locale: data.organization.defaultLocale,
      to: data.email,
      idempotencyKey: `organization/${data.organization.id}/invitation/${data.invitation.id}/send/${version}`,
      rendered: renderInvitationEmail(locale, {
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
    const locale = resolveEmailLocale(input.locale, this.config.defaultLocale);
    const payload: EmailPayload = {
      to: input.to,
      subject: input.rendered.subject,
      html: input.rendered.html,
      text: input.rendered.text,
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
