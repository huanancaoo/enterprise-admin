import { describe, expect, it } from 'vitest';
import {
  renderInvitationEmail,
  renderPasswordResetEmail,
  renderVerifyEmail,
} from './templates';

describe('email templates', () => {
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

  it('keeps zh-CN and en-US copy while marking document direction', () => {
    const verifyUrl = 'https://tenant.example.test/verify?token=verify-token';
    const resetUrl =
      'https://tenant.example.test/reset-password?token=reset-token';
    const invitationUrl =
      'https://tenant.example.test/accept-invitation/invitation-id';

    const zhVerify = renderVerifyEmail('zh-CN', {
      name: 'Taylor',
      verifyUrl,
    });
    expect(zhVerify.subject).toBe('验证你的邮箱');
    expect(zhVerify.text).toContain(
      '你好，Taylor。请点击下面的链接验证邮箱。链接只能使用一次。',
    );
    expect(zhVerify.html).toContain('<html lang="zh-CN" dir="ltr">');

    const enReset = renderPasswordResetEmail('en-US', {
      name: 'Taylor',
      resetUrl,
    });
    expect(enReset.subject).toBe('Reset your password');
    expect(enReset.text).toContain(
      'Hi Taylor。Click the link below to set a new password. The link expires in one hour and can be used once.',
    );
    expect(enReset.html).toContain('<html lang="en-US" dir="ltr">');

    const zhInvitation = renderInvitationEmail('zh-CN', {
      inviterName: 'Owner',
      organizationName: 'Mail org',
      acceptUrl: invitationUrl,
    });
    expect(zhInvitation.subject).toBe('你收到一个组织邀请：Mail org');
    expect(zhInvitation.text).toContain('Owner Mail org 邀请你加入组织。');
    expect(zhInvitation.html).toContain(`href="${invitationUrl}"`);

    const enInvitation = renderInvitationEmail('en-US', {
      inviterName: 'Owner',
      organizationName: 'Mail org',
      acceptUrl: invitationUrl,
    });
    expect(enInvitation.subject).toBe(
      'You are invited to an organization：Mail org',
    );
    expect(enInvitation.text).toContain(
      'Owner Mail org invited you to join an organization.',
    );
  });

  it('renders Arabic copy and RTL direction for all existing templates', () => {
    const verifyUrl =
      'https://tenant.example.test/api/auth/verify-email?token=verify-token';
    const resetUrl =
      'https://tenant.example.test/reset-password?token=reset-token';
    const invitationUrl =
      'https://tenant.example.test/accept-invitation/invitation-id';

    const verify = renderVerifyEmail('ar', { name: 'Taylor', verifyUrl });
    expect(verify.subject).toBe('تحقق من بريدك الإلكتروني');
    expect(verify.text).toContain(
      'مرحبًا Taylor، يرجى النقر على الرابط أدناه للتحقق من بريدك الإلكتروني.',
    );
    expect(verify.html).toContain('<html lang="ar" dir="rtl">');
    expect(verify.html).toContain(`href="${verifyUrl}"`);

    const reset = renderPasswordResetEmail('ar', { name: 'Taylor', resetUrl });
    expect(reset.subject).toBe('إعادة تعيين كلمة المرور');
    expect(reset.text).toContain(
      'انقر على الرابط أدناه لتعيين كلمة مرور جديدة.',
    );
    expect(reset.html).toContain('<html lang="ar" dir="rtl">');
    expect(reset.html).toContain(`href="${resetUrl}"`);

    const invitation = renderInvitationEmail('ar', {
      inviterName: 'Owner',
      organizationName: 'Mail org',
      acceptUrl: invitationUrl,
    });
    expect(invitation.subject).toBe('دعوة للانضمام إلى مؤسسة: Mail org');
    expect(invitation.text).toContain('Owner يدعوك للانضمام إلى Mail org.');
    expect(invitation.html).toContain('<html lang="ar" dir="rtl">');
    expect(invitation.html).toContain(`href="${invitationUrl}"`);
  });
});
