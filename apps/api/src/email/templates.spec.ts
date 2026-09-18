import { describe, expect, it } from 'vitest';
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerifyEmail,
  resolveEmailLocale,
} from './templates';

describe('email templates', () => {
  it('falls back to the configured locale when the request is not zh-CN or en-US', () => {
    expect(resolveEmailLocale('ar', 'zh-CN')).toBe('zh-CN');
    expect(resolveEmailLocale('en-US', 'zh-CN')).toBe('en-US');
  });

  it('escapes HTML in names and keeps the raw URL in both html and text', () => {
    const rendered = renderVerifyEmail('zh-CN', {
      name: '<script>alert(1)</script>',
      verifyUrl: 'http://localhost:3000/api/auth/verify-email?token=abc',
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    expect(rendered.html).toContain(
      'href="http://localhost:3000/api/auth/verify-email?token=abc"',
    );
    expect(rendered.text).toContain(
      'http://localhost:3000/api/auth/verify-email?token=abc',
    );
  });

  it('puts the organization name in the invitation subject', () => {
    const rendered = renderInvitationEmail('en-US', {
      inviterName: 'Ada',
      organizationName: 'Northwind',
      acceptUrl: 'http://localhost:3200/accept-invitation/id',
    });
    expect(rendered.subject).toContain('Northwind');
    const reset = renderPasswordResetEmail('zh-CN', {
      name: 'Ada',
      resetUrl: 'http://localhost:3200/reset-password?token=abc',
    });
    expect(reset.subject).toBe('重置你的密码');
  });
});
