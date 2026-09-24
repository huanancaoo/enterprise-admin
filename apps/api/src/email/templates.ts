import type { EmailLocale, EmailTemplateKey } from '@workspace/i18n';
import { emailCatalog } from '@workspace/i18n';

export const EMAIL_TEMPLATE_VERSION = 1;

export const emailTemplateKeys = [
  'verify-email',
  'password-reset',
  'organization.invitation',
] as const satisfies readonly EmailTemplateKey[];

export type { EmailTemplateKey };

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function letter(options: {
  locale: EmailLocale;
  templateKey: EmailTemplateKey;
  name: string;
  url: string;
  extraText?: string;
}): { subject: string; html: string; text: string } {
  const catalog = emailCatalog[options.templateKey][options.locale];
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

export function renderVerifyEmail(
  locale: EmailLocale,
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
  locale: EmailLocale,
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
  locale: EmailLocale,
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
