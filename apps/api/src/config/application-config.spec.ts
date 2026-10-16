import { describe, expect, it } from 'vitest';
import { readApplicationConfig } from './application-config';

function environment(): NodeJS.ProcessEnv {
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
    EMAIL_DISPATCH_INTERVAL_MS: '1000',
    EMAIL_RETRY_MAX_ATTEMPTS: '3',
    EMAIL_RETRY_BASE_DELAY_MS: '1000',
    EMAIL_MESSAGE_TTL_MS: '86400000',
  };
}

describe('application email configuration', () => {
  it('requires SMTP configuration without a second locale default', () => {
    const config = readApplicationConfig(environment());
    expect(config.email.smtp).toEqual({
      host: 'localhost',
      port: 1025,
      secure: false,
    });
    expect(config.email).not.toHaveProperty('defaultLocale');
    expect(() =>
      readApplicationConfig({ ...environment(), SMTP_HOST: undefined }),
    ).toThrow(/SMTP_HOST/);
  });
});

describe('application email configuration boundaries', () => {
  it('preserves explicit secure=false and accepts the SMTP port boundaries', () => {
    for (const port of ['1', '65535']) {
      expect(
        readApplicationConfig({ ...environment(), SMTP_PORT: port }).email.smtp,
      ).toMatchObject({ port: Number(port), secure: false });
    }
    expect(
      readApplicationConfig({ ...environment(), SMTP_SECURE: 'true' }).email
        .smtp.secure,
    ).toBe(true);
  });

  it.each(['0', '-1', '65536', '1.5', '', '9007199254740993'])(
    'rejects invalid SMTP port %s at configuration loading',
    (port) => {
      expect(() =>
        readApplicationConfig({ ...environment(), SMTP_PORT: port }),
      ).toThrow(/SMTP_PORT/);
    },
  );

  it.each(['1', '0', 'yes', 'FALSE', ''])(
    'rejects non-contract boolean %s',
    (secure) => {
      expect(() =>
        readApplicationConfig({ ...environment(), SMTP_SECURE: secure }),
      ).toThrow(/SMTP_SECURE/);
    },
  );

  it('rejects overflowing poll timers without capping valid message lifetimes', () => {
    expect(
      readApplicationConfig({
        ...environment(),
        EMAIL_DISPATCH_INTERVAL_MS: '2147483647',
      }).email.pollIntervalMs,
    ).toBe(2_147_483_647);
    expect(() =>
      readApplicationConfig({
        ...environment(),
        EMAIL_DISPATCH_INTERVAL_MS: '2147483648',
      }),
    ).toThrow(/EMAIL_DISPATCH_INTERVAL_MS/);
    expect(
      readApplicationConfig({
        ...environment(),
        EMAIL_MESSAGE_TTL_MS: '2147483648',
      }).email.messageTtlMs,
    ).toBe(2_147_483_648);
  });

  it('does not apply Node timer limits to database retry timestamps', () => {
    expect(
      readApplicationConfig({
        ...environment(),
        EMAIL_RETRY_BASE_DELAY_MS: '2147483648',
      }).email.retry.baseDelayMs,
    ).toBe(2_147_483_648);
  });

  it('preserves optional SMTP authentication and rejects one-sided credentials', () => {
    expect(
      readApplicationConfig({
        ...environment(),
        SMTP_USER: '',
        SMTP_PASSWORD: '',
      }).email.smtp,
    ).not.toHaveProperty('user');
    expect(
      readApplicationConfig({
        ...environment(),
        SMTP_USER: 'sender',
        SMTP_PASSWORD: 'secret',
      }).email.smtp,
    ).toMatchObject({ user: 'sender', password: 'secret' });
    expect(() =>
      readApplicationConfig({ ...environment(), SMTP_USER: 'sender' }),
    ).toThrow(/SMTP_PASSWORD/);
    expect(() =>
      readApplicationConfig({ ...environment(), SMTP_PASSWORD: 'secret' }),
    ).toThrow(/SMTP_PASSWORD/);
  });

  it('reports invalid field names without exposing credential values', () => {
    try {
      readApplicationConfig({
        ...environment(),
        SMTP_PORT: 'private-invalid-port',
        SMTP_PASSWORD: 'private-password',
      });
      throw new Error('Expected configuration rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('SMTP_PORT');
      expect((error as Error).message).not.toContain('private-invalid-port');
      expect((error as Error).message).not.toContain('private-password');
    }
  });
});
