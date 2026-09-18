import { describe, expect, it } from 'vitest';
import { assertAllowedEmailUrl, emailOriginAllowlist } from './email-url';

describe('email-url', () => {
  const allowed = ['http://localhost:3000', 'http://localhost:3200'];

  it('accepts http(s) URLs whose origin is on the allowlist', () => {
    expect(
      assertAllowedEmailUrl(
        'http://localhost:3000/api/auth/verify-email?token=abc',
        allowed,
      ).origin,
    ).toBe('http://localhost:3000');
  });

  it('rejects non-http schemes, userinfo, and unknown hosts', () => {
    expect(() => assertAllowedEmailUrl('javascript:alert(1)', allowed)).toThrow(
      'URL_NOT_ALLOWED',
    );
    expect(() =>
      assertAllowedEmailUrl('http://user:pass@localhost:3000/reset', allowed),
    ).toThrow('URL_NOT_ALLOWED');
    expect(() =>
      assertAllowedEmailUrl('http://evil.example/reset', allowed),
    ).toThrow('URL_NOT_ALLOWED');
  });

  it('builds a unique origin allowlist and rejects wildcard hosts', () => {
    expect(
      emailOriginAllowlist('http://localhost:3000', 'http://localhost:3200', [
        'http://localhost:3200',
        'http://localhost:3201',
      ]),
    ).toEqual([
      'http://localhost:3000',
      'http://localhost:3200',
      'http://localhost:3201',
    ]);
    expect(() =>
      emailOriginAllowlist('http://127.0.0.1', 'http://127.0.0.1:3200', [
        'http://127.0.0.1:*',
      ]),
    ).toThrow(/Invalid URL|email origin/);
  });
});
