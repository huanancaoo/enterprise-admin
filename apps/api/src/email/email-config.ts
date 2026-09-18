export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
};

export type EmailFrom = {
  email: string;
  name: string;
};

export type EmailConfig = {
  smtp: SmtpConfig;
  from: EmailFrom;
  encryptionKey: Buffer;
  linkOrigin: string;
  defaultLocale: 'zh-CN' | 'en-US';
  pollIntervalMs: number;
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
  };
  messageTtlMs: number;
};

export type EmailTemplateLocale = EmailConfig['defaultLocale'];
