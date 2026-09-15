import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApplication } from '../src/create-application';
import { AuthRuntime } from '../src/auth-runtime';

describe.sequential(
  'S4-01: Better Auth Client → Nest Express → runtime PostgreSQL',
  () => {
    let container: StartedTestContainer | undefined;
    let app: NestExpressApplication | undefined;
    let baseURL: string;
    let cookie = '';
    let revokedCookie: string;
    const origin = 'http://localhost:3200';
    const credentials = {
      email: 's4-01@example.test',
      password: randomBytes(24).toString('hex'),
    };
    const makeClient = () =>
      createAuthClient({
        baseURL,
        plugins: [
          organizationClient({ dynamicAccessControl: { enabled: true } }),
        ],
        fetchOptions: {
          // Node 没有浏览器 Cookie jar；仅补充传输层，认证操作仍全部使用正式客户端。
          customFetchImpl: async (input, init) => {
            const headers = new Headers(init?.headers);
            headers.set('origin', origin);
            if (cookie) headers.set('cookie', cookie);
            const response = await fetch(input, { ...init, headers });
            const cookies = response.headers.getSetCookie();
            if (cookies.length)
              cookie = cookies.map((item) => item.split(';')[0]).join('; ');
            return response;
          },
        },
      });
    let client: ReturnType<typeof makeClient>;

    beforeAll(async () => {
      const versions = JSON.parse(
        await readFile('../../docs/architecture/versions.json', 'utf8'),
      ) as { postgresql: { image: string } };
      const passwords = Array.from({ length: 4 }, () =>
        randomBytes(24).toString('hex'),
      );
      container = await new GenericContainer(versions.postgresql.image)
        .withEnvironment({
          POSTGRES_USER: 'bootstrap_admin',
          POSTGRES_DB: 'enterprise_admin',
          POSTGRES_PASSWORD: passwords[0],
          APP_MIGRATOR_PASSWORD: passwords[1],
          APP_RUNTIME_PASSWORD: passwords[2],
          PLATFORM_RUNTIME_PASSWORD: passwords[3],
        })
        .withCopyFilesToContainer([
          {
            source: resolve('../../infra/postgres/bootstrap.sql'),
            target: '/docker-entrypoint-initdb.d/001-bootstrap.sql',
          },
        ])
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            'database system is ready to accept connections',
            2,
          ),
        )
        .start();
      const url = (user: string, password: string) =>
        `postgresql://${user}:${password}@${container!.getHost()}:${container!.getMappedPort(5432)}/enterprise_admin`;
      await promisify(execFile)(
        process.execPath,
        [resolve('../../packages/database/src/migrate.ts')],
        {
          env: {
            PATH: process.env.PATH,
            MIGRATION_DATABASE_URL: url('app_migrator', passwords[1]),
          },
        },
      );
      app = await createApplication(
        {
          databaseURL: url('app_runtime', passwords[2]),
          baseURL: 'http://localhost:3000',
          secret: randomBytes(32).toString('hex'),
          trustedOrigins: [origin],
        },
        { logger: false },
      );
      await app.listen(0, '127.0.0.1');
      baseURL = await app.getUrl();
      client = makeClient();
    }, 180_000);

    afterAll(async () => {
      try {
        await app?.close();
        if (app) expect(app.get(AuthRuntime).pool.ended).toBe(true);
      } finally {
        await container?.stop();
      }
    }, 60_000);

    it('认证路径独立于业务前缀，保留 requestId 和 Swagger', async () => {
      const response = await fetch(`${baseURL}/api/auth/ok`);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(await (await fetch(`${baseURL}/api/v1`)).text()).toBe(
        'Hello World!',
      );
      expect((await fetch(`${baseURL}/api/v1/auth/ok`)).status).toBe(404);
      const document = (await (
        await fetch(`${baseURL}/api/docs-json`)
      ).json()) as { paths: Record<string, unknown> };
      expect(document.paths).toHaveProperty('/api/v1');
      expect(
        Object.keys(document.paths).some((path) =>
          path.startsWith('/api/auth'),
        ),
      ).toBe(false);
    });

    it('客户端通过 JSON 注册、登录、Cookie 恢复会话并访问组织插件', async () => {
      expect((await client.getSession()).data).toBeNull();
      const registered = await client.signUp.email({
        ...credentials,
        name: 'S4-01',
      });
      expect(registered.error).toBeNull();
      expect(registered.data?.user.id).toMatch(/^[0-9a-f-]{36}$/);
      await client.signOut();
      const signedIn = await client.signIn.email(credentials);
      expect(signedIn.error).toBeNull();
      expect(cookie).toContain('session_token=');
      expect((await client.getSession()).data?.user.id).toBe(
        registered.data?.user.id,
      );
      expect((await client.organization.list()).data).toEqual([]);
      revokedCookie = cookie;
    });

    it('带会话的非可信 Origin 写请求被拒绝', async () => {
      const response = await fetch(`${baseURL}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          origin: 'http://untrusted.example',
          cookie,
          'content-type': 'application/json',
        },
        body: '{}',
      });
      expect(response.status).toBe(403);
      expect((await client.getSession()).data?.user.email).toBe(
        credentials.email,
      );
    });

    it('客户端登出后旧 Cookie 无法恢复会话，错误密码不签发会话', async () => {
      expect((await client.signOut()).error).toBeNull();
      const response = await fetch(`${baseURL}/api/auth/get-session`, {
        headers: { cookie: revokedCookie },
      });
      expect(await response.json()).toBeNull();
      expect(
        (
          await client.signIn.email({
            ...credentials,
            password: 'incorrect-password',
          })
        ).error?.status,
      ).toBe(401);
    });
  },
);
