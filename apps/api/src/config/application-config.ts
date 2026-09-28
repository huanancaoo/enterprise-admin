import type { EmailConfig } from '../email/email-config';
import { emailLocales } from '@workspace/i18n';
import { parseEmailEncryptionKey } from '../email/email-crypto';
import { readAuthConfig, type AuthConfig } from '../identity/auth-runtime';

export interface ApplicationConfig extends AuthConfig {
  platformDatabaseURL: string;
  email: EmailConfig;
}

export function readApplicationConfig(
  env: NodeJS.ProcessEnv,
): ApplicationConfig {
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
  const defaultLocale = emailLocales.find(
    (locale) => locale === required('EMAIL_DEFAULT_LOCALE'),
  );
  if (!defaultLocale) {
    throw new Error(
      `EMAIL_DEFAULT_LOCALE must be one of ${emailLocales.map((locale) => `"${locale}"`).join(', ')}`,
    );
  }
  return {
    ...readAuthConfig(env),
    platformDatabaseURL: required('PLATFORM_DATABASE_URL'),
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
