import type { OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { redisStorage } from '@better-auth/redis-storage';
import { createDatabase } from '@workspace/database';
import {
  createAuth,
  getAuthRequestContext,
  type AuthEmailHooks,
} from '@workspace/database/auth';
import { isIP } from 'node:net';
import { z } from 'zod';
import { parseEnvironment } from '../config/environment';
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

// 可信代理沿用 Node 的 IP 语法（含 scoped IPv6）；Zod 的 CIDR 格式会缩窄现有接受范围。
const trustedProxySchema = z.string().refine(isTrustedProxyEntry);
const authEnvironmentSchema = z.object({
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) => value.split(',').map((origin) => origin.trim())),
  BETTER_AUTH_TRUSTED_PROXIES: z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? []
        : value.split(',').map((entry) => entry.trim()),
    )
    .pipe(z.array(trustedProxySchema)),
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  INVITATION_ORGANIZATION_HOURLY_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(100),
  INVITATION_ACTOR_HOURLY_LIMIT: z.coerce.number().int().positive().default(50),
  INVITATION_IP_HOURLY_LIMIT: z.coerce.number().int().positive().default(100),
});

export function readAuthConfig(env: NodeJS.ProcessEnv): AuthConfig {
  const value = parseEnvironment(authEnvironmentSchema, env);
  return {
    invitationLimits: {
      organization: value.INVITATION_ORGANIZATION_HOURLY_LIMIT,
      actor: value.INVITATION_ACTOR_HOURLY_LIMIT,
      ip: value.INVITATION_IP_HOURLY_LIMIT,
    },
    databaseURL: value.DATABASE_URL,
    redisURL: value.REDIS_URL,
    baseURL: value.BETTER_AUTH_URL,
    secret: value.BETTER_AUTH_SECRET,
    trustedOrigins: value.BETTER_AUTH_TRUSTED_ORIGINS,
    trustedProxies: value.BETTER_AUTH_TRUSTED_PROXIES,
    github: {
      clientId: value.GITHUB_CLIENT_ID,
      clientSecret: value.GITHUB_CLIENT_SECRET,
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
  private readonly logger = new Logger(AuthRuntime.name);
  readonly trustedOrigins: readonly string[];
  readonly pool: ReturnType<typeof createDatabase>['pool'];
  readonly auth: ReturnType<typeof createAuth>;
  private readonly redis: Redis;

  constructor(
    config: AuthConfig,
    emailHooks: (pool: AuthRuntime['pool']) => AuthEmailHooks,
  ) {
    this.trustedOrigins = [
      new URL(config.baseURL).origin,
      ...config.trustedOrigins,
    ];
    this.pool = createDatabase(config.databaseURL).pool;
    // pg 已移除失效空闲连接；处理事件避免进程退出及原始连接对象泄露。
    this.pool.on('error', (error) => {
      this.logger.error({
        event: 'database.pool.failed',
        errorCode: 'DATABASE_CONNECTION_ERROR',
        errorType: error.name,
      });
    });
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
