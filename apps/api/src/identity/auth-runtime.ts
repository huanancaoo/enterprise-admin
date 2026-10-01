import type { OnApplicationShutdown } from '@nestjs/common';
import { redisStorage } from '@better-auth/redis-storage';
import { createDatabase } from '@workspace/database';
import {
  createAuth,
  getAuthRequestContext,
  type AuthEmailHooks,
} from '@workspace/database/auth';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import Redis from 'ioredis';

export interface AuthConfig {
  invitationLimits?: { organization: number; actor: number; ip: number };
  databaseURL: string;
  redisURL: string;
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
  trustedProxies: string[];
  github: {
    clientId: string;
    clientSecret: string;
  };
}

function isTrustedProxyEntry(entry: string): boolean {
  const slash = entry.lastIndexOf('/');
  if (slash === -1) return isIP(entry) !== 0;
  const ip = entry.slice(0, slash);
  const prefixPart = entry.slice(slash + 1);
  if (!/^\d+$/.test(prefixPart)) return false;
  const version = isIP(ip);
  if (version === 0) return false;
  const prefix = Number(prefixPart);
  return prefix <= (version === 4 ? 32 : 128);
}

function parseTrustedProxies(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  const entries = value.split(',').map((entry) => entry.trim());
  const invalid = entries.filter((entry) => !isTrustedProxyEntry(entry));
  if (invalid.length > 0) {
    throw new Error(
      `BETTER_AUTH_TRUSTED_PROXIES entries must be IP addresses or CIDR ranges: ${invalid.join(', ')}`,
    );
  }
  return entries;
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
  function invitationLimit(name: string, defaultValue: number): number {
    const value = Number(env[name] ?? defaultValue);
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive integer`);
    return value;
  }
  return {
    invitationLimits: {
      organization: invitationLimit(
        'INVITATION_ORGANIZATION_HOURLY_LIMIT',
        100,
      ),
      actor: invitationLimit('INVITATION_ACTOR_HOURLY_LIMIT', 50),
      ip: invitationLimit('INVITATION_IP_HOURLY_LIMIT', 100),
    },
    databaseURL: required('DATABASE_URL'),
    redisURL: required('REDIS_URL'),
    baseURL: required('BETTER_AUTH_URL'),
    secret,
    trustedOrigins: required('BETTER_AUTH_TRUSTED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim()),
    trustedProxies: parseTrustedProxies(env.BETTER_AUTH_TRUSTED_PROXIES),
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
  readonly trustedOrigins: readonly string[];
  readonly pool: ReturnType<typeof createDatabase>['pool'];
  readonly auth: ReturnType<typeof createAuth>;
  readonly auditCursorKey: Buffer;
  private readonly redis: Redis;

  constructor(
    config: AuthConfig,
    emailHooks: (pool: AuthRuntime['pool']) => AuthEmailHooks,
  ) {
    this.trustedOrigins = [
      new URL(config.baseURL).origin,
      ...config.trustedOrigins,
    ];
    this.auditCursorKey = createHmac('sha256', config.secret)
      .update('enterprise-admin:audit-event-cursor:v1')
      .digest();
    this.pool = createDatabase(config.databaseURL).pool;
    // 与 Pool 一样延迟建连：OpenAPI 导出不触达 Redis。
    this.redis = new Redis(config.redisURL, { lazyConnect: true });
    try {
      // HTTP 的邮件入队与身份共用连接；CLI 显式选择不投递，绝不由缺配置推导。
      this.auth = createAuth(
        this.pool,
        config.baseURL,
        config.secret,
        config.trustedOrigins,
        suppressable(emailHooks(this.pool)),
        redisStorage({ client: this.redis }),
        config.trustedProxies,
        config.github,
        config.invitationLimits,
      );
    } catch (error) {
      this.redis.disconnect();
      void this.pool.end();
      throw error;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([
      this.pool.end(),
      this.redis.status === 'wait'
        ? Promise.resolve(this.redis.disconnect())
        : this.redis.quit(),
    ]);
  }
}
