import type { OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '@workspace/database';
import {
  createAuth,
  getAuthRequestContext,
  type AuthEmailHooks,
} from '@workspace/database/auth';

export interface AuthConfig {
  databaseURL: string;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  github: {
    clientId: string;
    clientSecret: string;
  };
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  function required(name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  }
  const secret = required('BETTER_AUTH_SECRET');
  if (secret.length < 32)
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  return {
    databaseURL: required('DATABASE_URL'),
    baseURL: required('BETTER_AUTH_URL'),
    secret,
    trustedOrigins: required('BETTER_AUTH_TRUSTED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim()),
    github: {
      clientId: required('GITHUB_CLIENT_ID'),
      clientSecret: required('GITHUB_CLIENT_SECRET'),
    },
  };
}

function suppressable(hooks: AuthEmailHooks): AuthEmailHooks {
  return {
    sendVerificationEmail: async (data) => {
      if (getAuthRequestContext()?.suppressAuthEmail) return;
      await hooks.sendVerificationEmail(data);
    },
    sendResetPassword: async (data) => {
      if (getAuthRequestContext()?.suppressAuthEmail) return;
      await hooks.sendResetPassword(data);
    },
    sendInvitationEmail: async (data) => {
      if (getAuthRequestContext()?.suppressAuthEmail) return;
      await hooks.sendInvitationEmail(data);
    },
  };
}

export class AuthRuntime implements OnApplicationShutdown {
  readonly pool: ReturnType<typeof createDatabase>['pool'];
  readonly auth: ReturnType<typeof createAuth>;

  constructor(
    config: AuthConfig,
    emailHooks: (pool: AuthRuntime['pool']) => AuthEmailHooks,
  ) {
    this.pool = createDatabase(config.databaseURL).pool;
    try {
      // HTTP 的邮件入队与身份共用连接；CLI 显式选择不投递，绝不由缺配置推导。
      this.auth = createAuth(
        this.pool,
        config.baseURL,
        config.secret,
        config.trustedOrigins,
        suppressable(emailHooks(this.pool)),
        config.github,
      );
    } catch (error) {
      void this.pool.end();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
