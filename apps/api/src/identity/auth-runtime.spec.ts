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
    ).toThrow(/BETTER_AUTH_TRUSTED_PROXIES/);
    expect(() =>
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: '192.0.2.1/33',
      }),
    ).toThrow(/BETTER_AUTH_TRUSTED_PROXIES/);
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

describe('readAuthConfig environment schema', () => {
  it('preserves invitation limit defaults and explicit overrides', () => {
    expect(readAuthConfig(required).invitationLimits).toEqual({
      organization: 100,
      actor: 50,
      ip: 100,
    });
    expect(
      readAuthConfig({ ...required, INVITATION_ORGANIZATION_HOURLY_LIMIT: '5' })
        .invitationLimits,
    ).toEqual({ organization: 5, actor: 50, ip: 100 });
  });

  it.each(['0', '-1', '1.5', '9007199254740993', ''])(
    'rejects invalid invitation limit %s',
    (limit) =>
      expect(() =>
        readAuthConfig({ ...required, INVITATION_ACTOR_HOURLY_LIMIT: limit }),
      ).toThrow(/INVITATION_ACTOR_HOURLY_LIMIT/),
  );

  it('accepts IPv4 and IPv6 CIDR boundaries', () => {
    expect(
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES:
          '0.0.0.0/0, 192.0.2.1/32, ::/0, 2001:db8::1/128',
      }).trustedProxies,
    ).toEqual(['0.0.0.0/0', '192.0.2.1/32', '::/0', '2001:db8::1/128']);
    expect(() =>
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: '2001:db8::1/129',
      }),
    ).toThrow(/BETTER_AUTH_TRUSTED_PROXIES/);
  });

  it('preserves Node IP syntax and the existing CIDR prefix representation', () => {
    const entries = [
      '::ffff:192.0.2.1',
      'fe80::1%eth0',
      'fe80::1%eth0/64',
      '192.0.2.1/032',
      '2001:db8::1/0128',
    ];
    expect(
      readAuthConfig({
        ...required,
        BETTER_AUTH_TRUSTED_PROXIES: entries.join(','),
      }).trustedProxies,
    ).toEqual(entries);
  });

  it('does not include secrets or connection strings in validation errors', () => {
    expect(() =>
      readAuthConfig({
        ...required,
        BETTER_AUTH_SECRET: 'private-short-secret',
      }),
    ).toThrow('Invalid application configuration: BETTER_AUTH_SECRET');
  });
});
