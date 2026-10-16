import { z } from 'zod';
import type { EmailConfig } from '../email/email-config';
import { parseEmailEncryptionKey } from '../email/email-crypto';
import { readAuthConfig, type AuthConfig } from '../identity/auth-runtime';
import { readFilesConfig } from '../files/files-config';
import type { StorageConfig } from '../files/storage/storage';
import { parseEnvironment } from './environment';

export interface ApplicationConfig extends AuthConfig {
  email: EmailConfig;
  files?: StorageConfig;
}

// Node 会把超过有符号 32 位范围的定时器延迟改成 1ms，必须在启动时拒绝。
const timerMilliseconds = z.coerce.number().int().min(1).max(2_147_483_647);
const emailEnvironmentSchema = z
  .object({
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().min(1),
    EMAIL_FROM_NAME: z.string().min(1),
    EMAIL_PAYLOAD_ENCRYPTION_KEY: z.string().min(1),
    EMAIL_LINK_ORIGIN: z.string().min(1),
    EMAIL_DISPATCH_INTERVAL_MS: timerMilliseconds,
    EMAIL_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive(),
    EMAIL_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive(),
    EMAIL_MESSAGE_TTL_MS: z.coerce.number().int().positive(),
  })
  .refine(
    (value) => Boolean(value.SMTP_USER) === Boolean(value.SMTP_PASSWORD),
    {
      path: ['SMTP_PASSWORD'],
      message: 'SMTP_USER and SMTP_PASSWORD must both be set or both omitted',
    },
  );

export function readApplicationConfig(
  env: NodeJS.ProcessEnv,
): ApplicationConfig {
  const value = parseEnvironment(emailEnvironmentSchema, env);
  return {
    ...readAuthConfig(env),
    files: readFilesConfig(env),
    email: {
      smtp: {
        host: value.SMTP_HOST,
        port: value.SMTP_PORT,
        secure: value.SMTP_SECURE,
        ...(value.SMTP_USER && value.SMTP_PASSWORD
          ? { user: value.SMTP_USER, password: value.SMTP_PASSWORD }
          : {}),
      },
      from: {
        email: value.EMAIL_FROM,
        name: value.EMAIL_FROM_NAME,
      },
      encryptionKey: parseEmailEncryptionKey(
        value.EMAIL_PAYLOAD_ENCRYPTION_KEY,
      ),
      linkOrigin: value.EMAIL_LINK_ORIGIN,
      pollIntervalMs: value.EMAIL_DISPATCH_INTERVAL_MS,
      retry: {
        maxAttempts: value.EMAIL_RETRY_MAX_ATTEMPTS,
        baseDelayMs: value.EMAIL_RETRY_BASE_DELAY_MS,
      },
      messageTtlMs: value.EMAIL_MESSAGE_TTL_MS,
    },
  };
}
