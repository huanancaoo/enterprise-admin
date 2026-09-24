import { describe, expect, it } from 'vitest';
import { readAuthConfig } from './auth-runtime';

const required = {
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3200',
  GITHUB_CLIENT_ID: 'test-github-client-id',
  GITHUB_CLIENT_SECRET: 'test-github-client-secret',
};

describe('readAuthConfig trustedProxies', () => {
  it('treats missing or blank BETTER_AUTH_TRUSTED_PROXIES as no proxies', () => {
    expect(readAuthConfig(required).trustedProxies).toEqual([]);
    expect(
      readAuthConfig({ ...required, BETTER_AUTH_TRUSTED_PROXIES: '' })
        .trustedProxies,
    ).toEqual([]);
    expect(
      readAuthConfig({ ...required, BETTER_AUTH_TRUSTED_PROXIES: '  ' })
        .trustedProxies,
    ).toEqual([]);
  });

  it('parses comma-separated IP addresses and CIDR ranges', () => {
    expect(
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: '192.0.2.10, 10.0.0.0/24, 2001:db8::1',
      }).trustedProxies,
    ).toEqual(['192.0.2.10', '10.0.0.0/24', '2001:db8::1']);
  });

  it('rejects invalid entries instead of dropping them', () => {
    expect(() =>
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: '192.0.2.1, not-an-ip',
      }),
    ).toThrow(/not-an-ip/);
    expect(() =>
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: '192.0.2.1/33',
      }),
    ).toThrow(/192\.0\.2\.1\/33/);
    expect(() =>
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: '192.0.2.1,',
      }),
    ).toThrow(/BETTER_AUTH_TRUSTED_PROXIES/);
  });
});

describe('readAuthConfig github', () => {
  it('requires GitHub OAuth credentials', () => {
    expect(readAuthConfig(required).github).toEqual({
      clientId: 'test-github-client-id',
      clientSecret: 'test-github-client-secret',
    });
    expect(() =>
      readAuthConfig({ ...required, GITHUB_CLIENT_ID: undefined }),
    ).toThrow(/GITHUB_CLIENT_ID/);
    expect(() =>
      readAuthConfig({ ...required, GITHUB_CLIENT_SECRET: undefined }),
    ).toThrow(/GITHUB_CLIENT_SECRET/);
  });
});
