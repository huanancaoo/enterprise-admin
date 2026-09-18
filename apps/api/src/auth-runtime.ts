import type { OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '@workspace/database';
import {
  createAuth,
  getAuthRequestContext,
  type AuthEmailHooks,
} from '@workspace/database/auth';
import type { EmailConfig } from './email/email-config';
import { parseEmailEncryptionKey } from './email/email-crypto';
import { EmailDispatcher } from './email/email-dispatcher';
import { EmailService } from './email/email.service';
import { emailOriginAllowlist } from './email/email-url';
import { SmtpEmailProvider } from './email/smtp-email.provider';

export interface AuthConfig {
  databaseURL: string;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  email: EmailConfig;
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  function required(name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  }
  function requiredInt(name: string): number {
    const value = Number(required(name));
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return value;
  }
  const secret = required('BETTER_AUTH_SECRET');
  if (secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  }
  const smtpUser = env.SMTP_USER;
  const smtpPassword = env.SMTP_PASSWORD;
  if (Boolean(smtpUser) !== Boolean(smtpPassword)) {
    throw new Error(
      'SMTP_USER and SMTP_PASSWORD must both be set or both omitted',
    );
  }
  const smtpSecure = required('SMTP_SECURE');
  if (smtpSecure !== 'true' && smtpSecure !== 'false') {
    throw new Error('SMTP_SECURE must be "true" or "false"');
  }
  const defaultLocale = required('EMAIL_DEFAULT_LOCALE');
  if (defaultLocale !== 'zh-CN' && defaultLocale !== 'en-US') {
    throw new Error('EMAIL_DEFAULT_LOCALE must be "zh-CN" or "en-US"');
  }
  const trustedOrigins = required('BETTER_AUTH_TRUSTED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim());
  return {
    databaseURL: required('DATABASE_URL'),
    baseURL: required('BETTER_AUTH_URL'),
    secret,
    trustedOrigins,
    email: {
      smtp: {
        host: required('SMTP_HOST'),
        port: requiredInt('SMTP_PORT'),
        secure: smtpSecure === 'true',
        ...(smtpUser && smtpPassword
          ? { user: smtpUser, password: smtpPassword }
          : {}),
      },
      from: {
        email: required('EMAIL_FROM'),
        name: required('EMAIL_FROM_NAME'),
      },
      encryptionKey: parseEmailEncryptionKey(
        required('EMAIL_PAYLOAD_ENCRYPTION_KEY'),
      ),
      linkOrigin: required('EMAIL_LINK_ORIGIN'),
      defaultLocale,
      pollIntervalMs: requiredInt('EMAIL_DISPATCH_INTERVAL_MS'),
      retry: {
        maxAttempts: requiredInt('EMAIL_RETRY_MAX_ATTEMPTS'),
        baseDelayMs: requiredInt('EMAIL_RETRY_BASE_DELAY_MS'),
      },
      messageTtlMs: requiredInt('EMAIL_MESSAGE_TTL_MS'),
    },
  };
}

function suppressable(hooks: AuthEmailHooks): AuthEmailHooks {
  return {
    sendVerificationEmail: async (data) => {
      if (getAuthRequestContext()?.suppressAuthEmail) return;
      await hooks.sendVerificationEmail(data);
    },
    sendResetPassword: async (data) => {
      if (getAuthRequestContext()?.suppressAuthEmail) return;
      await hooks.sendResetPassword(data);
    },
    sendInvitationEmail: async (data) => {
      if (getAuthRequestContext()?.suppressAuthEmail) return;
      await hooks.sendInvitationEmail(data);
    },
  };
}

export class AuthRuntime implements OnApplicationShutdown {
  readonly pool: ReturnType<typeof createDatabase>['pool'];
  readonly auth: ReturnType<typeof createAuth>;
  private readonly smtp: SmtpEmailProvider;
  private readonly dispatcher: EmailDispatcher;

  constructor(config: AuthConfig) {
    this.pool = createDatabase(config.databaseURL).pool;
    this.smtp = new SmtpEmailProvider(config.email.smtp, config.email.from);
    const emailService = new EmailService(
      this.pool,
      config.email,
      emailOriginAllowlist(
        config.baseURL,
        config.email.linkOrigin,
        config.trustedOrigins,
      ),
    );
    this.dispatcher = new EmailDispatcher(this.pool, this.smtp, config.email);
    this.auth = createAuth(
      this.pool,
      config.baseURL,
      config.secret,
      config.trustedOrigins,
      suppressable(emailService.hooks()),
    );
  }

  startEmailDispatcher(): void {
    this.dispatcher.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.dispatcher.stop();
    this.smtp.close();
    await this.pool.end();
  }
}
