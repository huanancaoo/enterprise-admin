import { describe, expect, it } from 'vitest';
import { readApplicationConfig } from './application-config';

function environment(defaultLocale: string): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3200',
    GITHUB_CLIENT_ID: 'github-client',
    GITHUB_CLIENT_SECRET: 'github-secret',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    EMAIL_FROM: 'noreply@example.test',
    EMAIL_FROM_NAME: 'Test',
    EMAIL_PAYLOAD_ENCRYPTION_KEY: 'a'.repeat(64),
    EMAIL_LINK_ORIGIN: 'http://localhost:3200',
    EMAIL_DEFAULT_LOCALE: defaultLocale,
    EMAIL_DISPATCH_INTERVAL_MS: '1000',
    EMAIL_RETRY_MAX_ATTEMPTS: '3',
    EMAIL_RETRY_BASE_DELAY_MS: '1000',
    EMAIL_MESSAGE_TTL_MS: '86400000',
  };
}

describe('application email locale configuration', () => {
  it.each(['zh-CN', 'en-US', 'ar'])(
    'accepts %s as EMAIL_DEFAULT_LOCALE',
    (defaultLocale) => {
      expect(
        readApplicationConfig(environment(defaultLocale)).email.defaultLocale,
      ).toBe(defaultLocale);
    },
  );
});
