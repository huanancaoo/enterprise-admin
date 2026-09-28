import type { EmailLocale, EmailTemplateKey } from '@workspace/i18n';
import { emailCatalog, localeMeta } from '@workspace/i18n';

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
  const isRtl = localeMeta[options.locale].direction === 'rtl';
  const subject =
    options.templateKey === 'organization.invitation'
      ? `${catalog.subject}${isRtl ? ': ' : '：'}${options.extraText}`
      : catalog.subject;
  const intro =
    options.templateKey === 'organization.invitation'
      ? isRtl
        ? `${catalog.greeting(name)} ${extra}${catalog.body}`
        : `${catalog.greeting(name)} ${extra} ${catalog.body}`
      : `${catalog.greeting(name)}${isRtl ? '، ' : '。'}${catalog.body}`;
  const html = `<!doctype html><html lang="${options.locale}" dir="${localeMeta[options.locale].direction}"><body><p>${intro}</p><p><a href="${escapeHtml(url)}">${catalog.action}</a></p><p>${catalog.ignore}</p></body></html>`;
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
