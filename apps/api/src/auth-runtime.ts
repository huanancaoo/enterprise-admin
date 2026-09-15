import type { OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '@workspace/database';
import { createAuth } from '@workspace/database/auth';

export interface AuthConfig {
  databaseURL: string;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
}

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  function required(name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  }
  const secret = required('BETTER_AUTH_SECRET');
  if (secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
  }
  return {
    databaseURL: required('DATABASE_URL'),
    baseURL: required('BETTER_AUTH_URL'),
    secret,
    trustedOrigins: required('BETTER_AUTH_TRUSTED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim()),
  };
}

export class AuthRuntime implements OnApplicationShutdown {
  readonly pool: ReturnType<typeof createDatabase>['pool'];
  readonly auth: ReturnType<typeof createAuth>;

  constructor(config: AuthConfig) {
    this.pool = createDatabase(config.databaseURL).pool;
    this.auth = createAuth(
      this.pool,
      config.baseURL,
      config.secret,
      config.trustedOrigins,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
