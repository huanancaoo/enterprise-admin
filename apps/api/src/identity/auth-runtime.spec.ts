import { describe, expect, it } from 'vitest';
import { readAuthConfig } from './auth-runtime';

const required = {
  DATABASE_URL: 'postgresql://localhost/test',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:3200',
  GITHUB_CLIENT_ID: 'test-github-client-id',
  GITHUB_CLIENT_SECRET: 'test-github-client-secret',
};

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
