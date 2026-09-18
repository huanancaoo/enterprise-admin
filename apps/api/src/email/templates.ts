import type { EmailTemplateLocale } from './email-config';

export const EMAIL_TEMPLATE_VERSION = 1;

export const emailTemplateKeys = [
  'verify-email',
  'password-reset',
  'organization.invitation',
] as const;

export type EmailTemplateKey = (typeof emailTemplateKeys)[number];

type Catalog = {
  subject: string;
  greeting: (name: string) => string;
  body: string;
  action: string;
  ignore: string;
};

const catalogs: Record<
  EmailTemplateKey,
  Record<EmailTemplateLocale, Catalog>
> = {
  'verify-email': {
    'zh-CN': {
      subject: '验证你的邮箱',
      greeting: (name) => `你好，${name}`,
      body: '请点击下面的链接验证邮箱。链接只能使用一次。',
      action: '验证邮箱',
      ignore: '如果不是你本人操作，请忽略这封邮件。',
    },
    'en-US': {
      subject: 'Verify your email',
      greeting: (name) => `Hi ${name}`,
      body: 'Click the link below to verify your email. The link can be used once.',
      action: 'Verify email',
      ignore: 'If you did not request this, ignore this email.',
    },
  },
  'password-reset': {
    'zh-CN': {
      subject: '重置你的密码',
      greeting: (name) => `你好，${name}`,
      body: '请点击下面的链接设置新密码。链接在一小时内有效，且只能使用一次。',
      action: '重置密码',
      ignore: '如果不是你本人操作，请忽略这封邮件。',
    },
    'en-US': {
      subject: 'Reset your password',
      greeting: (name) => `Hi ${name}`,
      body: 'Click the link below to set a new password. The link expires in one hour and can be used once.',
      action: 'Reset password',
      ignore: 'If you did not request this, ignore this email.',
    },
  },
  'organization.invitation': {
    'zh-CN': {
      subject: '你收到一个组织邀请',
      greeting: (name) => name,
      body: '邀请你加入组织。',
      action: '接受邀请',
      ignore: '如果这不是写给你的，请忽略这封邮件。',
    },
    'en-US': {
      subject: 'You are invited to an organization',
      greeting: (name) => name,
      body: 'invited you to join an organization.',
      action: 'Accept invitation',
      ignore: 'If this was not meant for you, ignore this email.',
    },
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function letter(options: {
  locale: EmailTemplateLocale;
  templateKey: EmailTemplateKey;
  name: string;
  url: string;
  extraText?: string;
}): { subject: string; html: string; text: string } {
  const catalog = catalogs[options.templateKey][options.locale];
  const name = escapeHtml(options.name);
  const extra = options.extraText ? escapeHtml(options.extraText) : '';
  const url = options.url;
  const subject =
    options.templateKey === 'organization.invitation'
      ? `${catalog.subject}：${options.extraText}`
      : catalog.subject;
  const intro =
    options.templateKey === 'organization.invitation'
      ? `${catalog.greeting(name)} ${extra} ${catalog.body}`
      : `${catalog.greeting(name)}。${catalog.body}`;
  const html = `<!doctype html><html lang="${options.locale}"><body><p>${intro}</p><p><a href="${escapeHtml(url)}">${catalog.action}</a></p><p>${catalog.ignore}</p></body></html>`;
  const text = `${intro}\n${url}\n${catalog.ignore}`;
  return { subject, html, text };
}

export function resolveEmailLocale(
  requested: string | null | undefined,
  fallback: EmailTemplateLocale,
): EmailTemplateLocale {
  if (requested === 'zh-CN' || requested === 'en-US') return requested;
  return fallback;
}

export function renderVerifyEmail(
  locale: EmailTemplateLocale,
  vars: { name: string; verifyUrl: string },
) {
  return letter({
    locale,
    templateKey: 'verify-email',
    name: vars.name,
    url: vars.verifyUrl,
  });
}

export function renderPasswordResetEmail(
  locale: EmailTemplateLocale,
  vars: { name: string; resetUrl: string },
) {
  return letter({
    locale,
    templateKey: 'password-reset',
    name: vars.name,
    url: vars.resetUrl,
  });
}

export function renderInvitationEmail(
  locale: EmailTemplateLocale,
  vars: { inviterName: string; organizationName: string; acceptUrl: string },
) {
  return letter({
    locale,
    templateKey: 'organization.invitation',
    name: vars.inviterName,
    url: vars.acceptUrl,
    extraText: vars.organizationName,
  });
}
