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
import { AuthorizationService } from '../src/authorization/authorization.service';
import type { EmailConfig } from '../src/email/email-config';
import { AuthRuntime } from '../src/identity/auth-runtime';
import { IdentityService } from '../src/identity/identity.service';
import {
  Controller,
  Get,
  ForbiddenException,
  UnauthorizedException,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDatabase } from '@workspace/database';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { configureApp } from '../src/http/configure-app';
import { RequestLanguage } from '../src/http/request-language';
import { Projects } from '../src/projects/projects';
import { TenantContextService } from '../src/tenancy/tenant-context.service';
import {
  CurrentTenant,
  RequireTenant,
  TenantGuard,
} from '../src/tenancy/tenant.guard';
import { projectRepository } from '@workspace/database/repositories/projects';

// 探针只在测试模块注册，不向正式应用增加业务或调试端点。
@Controller('organizations/:organizationId/probe')
class TenantProbeController {
  enteredMutations = 0;
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly projects: Projects,
  ) {}

  @Delete(':projectId')
  @HttpCode(204)
  @RequireTenant({ project: ['delete'] })
  async remove(
    @CurrentTenant() context: TenantContext,
    @Param('projectId', new ParseUUIDPipe({ version: '4' })) projectId: string,
  ) {
    this.enteredMutations++;
    await this.projects.delete(context, projectId);
  }

  @Get()
  @RequireTenant({ project: ['read'] })
  async read(@CurrentTenant() context: TenantContext) {
    return createTenantRunner(this.runtime.pool)(context, async (tx) => {
      const result = await tx.execute(
        "SELECT current_setting('app.organization_id') AS organization_id",
      );
      return {
        ...context,
        databaseOrganizationId: result.rows[0].organization_id,
      };
    });
  }
}

describe(
  'S4-01: Better Auth Client → Nest Express → runtime PostgreSQL',
  { concurrent: false },
  () => {
    let container: StartedTestContainer | undefined;
    let app: NestExpressApplication | undefined;
    let platformDatabase: ReturnType<typeof createDatabase> | undefined;
    let migratorDatabase: ReturnType<typeof createDatabase> | undefined;
    let baseURL: string;
    let cookie = '';
    let revokedCookie: string;
    const origin = 'http://localhost:3200';
    const emailConfig: EmailConfig = {
      smtp: { host: '127.0.0.1', port: 1025, secure: false },
      from: { email: 'noreply@example.test', name: 'Enterprise Admin' },
      encryptionKey: Buffer.alloc(32, 7),
      linkOrigin: origin,
      defaultLocale: 'zh-CN',
      pollIntervalMs: 50,
      retry: { maxAttempts: 5, baseDelayMs: 50 },
      messageTtlMs: 86_400_000,
    };
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
            const requestURL =
              input instanceof Request ? input.url : input.toString();
            if (
              /\/organization\/(update-member-role|update-role|delete-role)$/.test(
                requestURL,
              ) &&
              typeof init?.body === 'string'
            ) {
              const body = JSON.parse(init.body) as { organizationId: string };
              const result = await migratorDatabase!.pool.query<{
                authorization_version: number;
              }>(
                'SELECT authorization_version FROM organization_status WHERE organization_id = $1',
                [body.organizationId],
              );
              headers.set(
                'X-Expected-Authz-Version',
                String(result.rows[0].authorization_version),
              );
            }
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
      migratorDatabase = createDatabase(url('app_migrator', passwords[1]));
      platformDatabase = createDatabase(url('platform_runtime', passwords[3]));
      app = await createApplication(
        {
          databaseURL: url('app_runtime', passwords[2]),
          baseURL: 'http://localhost:3000',
          secret: randomBytes(32).toString('hex'),
          trustedOrigins: [origin],
          github: {
            clientId: 'test-github-client-id',
            clientSecret: 'test-github-client-secret',
          },
          email: emailConfig,
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
        await migratorDatabase?.pool.end();
        await platformDatabase?.pool.end();
        await container?.stop();
      }
    }, 60_000);

    it('认证路径独立于业务前缀，保留 requestId 和 Swagger', async () => {
      const response = await fetch(`${baseURL}/api/auth/ok`);
      expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect((await fetch(`${baseURL}/api/v1`)).status).toBe(404);
      expect((await fetch(`${baseURL}/api/v1/auth/ok`)).status).toBe(404);
      const document = (await (
        await fetch(`${baseURL}/api/docs-json`)
      ).json()) as { paths: Record<string, unknown> };
      expect(document.paths).toHaveProperty('/api/v1/me/organizations');
      expect(
        Object.keys(document.paths).some((path) =>
          path.startsWith('/api/auth'),
        ),
      ).toBe(false);
    });

    it('GitHub 登录返回 GitHub authorize URL', async () => {
      const response = await fetch(`${baseURL}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin,
        },
        body: JSON.stringify({
          provider: 'github',
          callbackURL: `${origin}/app`,
        }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        redirect: boolean;
        url: string;
      };
      expect(body.redirect).toBe(true);
      const authorize = new URL(body.url);
      expect(authorize.origin).toBe('https://github.com');
      expect(authorize.pathname).toBe('/login/oauth/authorize');
      expect(authorize.searchParams.get('client_id')).toBe(
        'test-github-client-id',
      );
      expect(authorize.searchParams.get('scope')?.split(/[+\s]/)).toEqual(
        expect.arrayContaining(['user:email']),
      );
      expect(authorize.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3000/api/auth/callback/github',
      );
    });

    it('客户端通过 JSON 注册、登录、Cookie 恢复会话并访问组织插件', async () => {
      expect((await client.getSession()).data).toBeNull();
      const registered = await client.signUp.email({
        ...credentials,
        name: 'S4-01',
      });
      expect(registered.error).toBeNull();
      expect(registered.data?.user.id).toMatch(/^[0-9a-f-]{36}$/);
      await migratorDatabase!.pool.query(
        'UPDATE public."user" SET email_verified = true WHERE id = $1',
        [registered.data!.user.id],
      );
      expect(
        (
          await migratorDatabase!.pool.query(
            'SELECT last_login_method FROM public."user" WHERE id = $1',
            [registered.data!.user.id],
          )
        ).rows[0].last_login_method,
      ).toBe('email');
      expect(cookie).not.toContain('last_used_login_method=');
      const signedIn = await client.signIn.email(credentials);
      expect(signedIn.error).toBeNull();
      expect(cookie).toContain('session_token=');
      expect(cookie).toContain('last_used_login_method=email');
      expect((await client.getSession()).data?.user.id).toBe(
        registered.data?.user.id,
      );
      expect(
        (
          await app!.get(AuthRuntime).auth.api.getSession({
            headers: new Headers({ cookie }),
          })
        )?.user.lastLoginMethod,
      ).toBe('email');
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

    it('S4-03：身份投影与目标组织授权使用真实会话、成员和动态角色', async () => {
      const identity = app!.get(IdentityService);
      const authorization = app!.get(AuthorizationService);
      const ownerCookie = cookie;
      const ownerHeaders = new Headers({ cookie });
      const session = (await client.getSession()).data!;
      expect(await identity.requireIdentity(ownerHeaders)).toEqual({
        userId: session.user.id,
        sessionId: session.session.id,
        preferredLocale: null,
      });
      expect(await identity.getIdentity(new Headers())).toBeNull();
      await expect(
        identity.requireIdentity(new Headers()),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const organization = await client.organization.create({
        name: 'Adapter A',
        slug: 'adapter-a',
      });
      expect(organization.error).toBeNull();
      const organizationId = organization.data!.id;
      await expect(
        authorization.requirePermission(ownerHeaders, organizationId, {
          project: ['create'],
        }),
      ).resolves.toBeUndefined();
      await expect(
        authorization.requirePermission(new Headers(), organizationId, {
          project: ['read'],
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        (
          await client.organization.createRole({
            organizationId,
            role: 'reader',
            permission: { project: ['read'] },
          })
        ).error,
      ).toBeNull();

      cookie = '';
      try {
        const otherPassword = randomBytes(24).toString('hex');
        const other = await client.signUp.email({
          email: 'adapter-member@example.test',
          password: otherPassword,
          name: 'Adapter member',
        });
        expect(other.error).toBeNull();
        await migratorDatabase!.pool.query(
          'UPDATE public."user" SET email_verified = true WHERE id = $1',
          [other.data!.user.id],
        );
        expect(
          (
            await client.signIn.email({
              email: 'adapter-member@example.test',
              password: otherPassword,
            })
          ).error,
        ).toBeNull();
        const otherOrganization = await client.organization.create({
          name: 'Adapter B',
          slug: 'adapter-b',
        });
        expect(otherOrganization.error).toBeNull();
        const otherHeaders = new Headers({ cookie });
        // 当前工作区是 B，也不能借此获得 A 的权限。
        await expect(
          authorization.requirePermission(otherHeaders, organizationId, {
            project: ['read'],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        const member = await app!.get(AuthRuntime).auth.api.addMember({
          headers: ownerHeaders,
          body: {
            organizationId,
            userId: other.data!.user.id,
            role: 'member',
          },
        });
        cookie = ownerCookie;
        expect(
          (
            await client.organization.updateMemberRole({
              organizationId,
              memberId: member.id,
              role: 'reader',
            })
          ).error,
        ).toBeNull();
        await expect(
          authorization.requirePermission(otherHeaders, organizationId, {
            project: ['read'],
          }),
        ).resolves.toBeUndefined();
        await expect(
          authorization.requirePermission(otherHeaders, organizationId, {
            project: ['create'],
          }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        cookie = ownerCookie;
        expect(
          (
            await client.organization.updateRole({
              organizationId,
              roleName: 'reader',
              data: { permission: { project: ['read', 'create'] } },
            })
          ).error,
        ).toBeNull();
        await expect(
          authorization.requirePermission(otherHeaders, organizationId, {
            project: ['create'],
          }),
        ).resolves.toBeUndefined();
      } finally {
        cookie = ownerCookie;
      }
    });

    it('S4-04：真实 HTTP 授权后建立目标组织上下文并进入 RLS 事务', async () => {
      const runtime = app!.get(AuthRuntime);
      const fixture = await Test.createTestingModule({
        controllers: [TenantProbeController],
        providers: [
          TenantGuard,
          TenantContextService,
          Projects,
          { provide: AuthRuntime, useValue: { pool: runtime.pool } },
          {
            provide: IdentityService,
            useValue: app!.get<IdentityService>(IdentityService),
          },
          {
            provide: AuthorizationService,
            useValue: app!.get<AuthorizationService>(AuthorizationService),
          },
        ],
      }).compile();
      // 不让测试模块关闭正式应用持有的同一个数据库池。
      const probe = fixture.createNestApplication<NestExpressApplication>({
        logger: false,
      });
      configureApp(probe);
      await probe.listen(0, '127.0.0.1');
      const probeURL = await probe.getUrl();
      const ownerCookie = cookie;
      const remove = (
        organizationId: string,
        projectId: string,
        sessionCookie = cookie,
      ) =>
        fetch(
          `${probeURL}/api/v1/organizations/${organizationId}/probe/${projectId}`,
          { method: 'DELETE', headers: { cookie: sessionCookie } },
        );
      const get = (id: string, sessionCookie = cookie) =>
        fetch(
          `${probeURL}/api/v1/organizations/${id}/probe?userId=forged&membershipId=forged`,
          {
            headers: {
              cookie: sessionCookie,
              'x-request-id': 'forged',
              'x-organization-id': 'forged',
            },
          },
        );
      try {
        const a = (
          await client.organization.create({
            name: 'Context A',
            slug: 'context-a',
          })
        ).data!;
        const b = (
          await client.organization.create({
            name: 'Context B',
            slug: 'context-b',
          })
        ).data!;
        expect((await get(a.id, '')).status).toBe(401);
        expect((await get('invalid')).status).toBe(400);
        const responses = await Promise.all([
          get(a.id),
          get(b.id),
          get(a.id),
          get(b.id),
        ]);
        for (const [index, response] of responses.entries()) {
          expect(response.status).toBe(200);
          const body = (await response.json()) as TenantContext & {
            databaseOrganizationId: string;
          };
          const target = index % 2 === 0 ? a.id : b.id;
          expect(body.organizationId).toBe(target);
          expect(body.databaseOrganizationId).toBe(target);
          expect(body.requestId).toBe(response.headers.get('x-request-id'));
          expect(body.requestId).not.toBe('forged');
          expect(body.membershipId).not.toBe('forged');
          expect(body.userId).toBe((await client.getSession()).data!.user.id);
        }
        const contextA = await app!
          .get<TenantContextService>(TenantContextService)
          .resolve(
            new Headers({ cookie }),
            a.id,
            { project: ['create'] },
            'test-setup-a',
            new RequestLanguage(null),
          );
        const contextB = await app!
          .get<TenantContextService>(TenantContextService)
          .resolve(
            new Headers({ cookie }),
            b.id,
            { project: ['create'] },
            'test-setup-b',
            new RequestLanguage(null),
          );
        const run = createTenantRunner(runtime.pool);
        const seed = (context: TenantContext) =>
          run(context, (tx) =>
            projectRepository.create(tx, {
              name: 'S4 resource',
              description: null,
              contentLocale: 'zh-CN',
            }),
          );
        const resourceA = await seed(contextA);
        const resourceB = await seed(contextB);
        const intact = async () => {
          expect(
            (await run(contextA, (tx) => projectRepository.list(tx))).some(
              (item) => item.id === resourceA.id,
            ),
          ).toBe(true);
          expect(
            (await run(contextB, (tx) => projectRepository.list(tx))).some(
              (item) => item.id === resourceB.id,
            ),
          ).toBe(true);
        };
        const deniedMutation = async (
          expected: number,
          sessionCookie: string,
        ) => {
          const entered = probe.get<TenantProbeController>(
            TenantProbeController,
          ).enteredMutations;
          expect((await remove(a.id, resourceA.id, sessionCookie)).status).toBe(
            expected,
          );
          expect(
            probe.get<TenantProbeController>(TenantProbeController)
              .enteredMutations,
          ).toBe(entered);
          await intact();
        };
        await deniedMutation(401, '');
        expect((await remove(a.id, resourceB.id)).status).toBe(404);
        await intact();
        const disposable = await seed(contextA);
        expect((await remove(a.id, disposable.id)).status).toBe(204);
        expect(
          (await run(contextA, (tx) => projectRepository.list(tx))).some(
            (item) => item.id === disposable.id,
          ),
        ).toBe(false);
        await expect(
          runtime.pool.query(
            "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
            [a.id],
          ),
        ).rejects.toThrow(/permission denied/);
        await expect(
          platformDatabase!.pool.query(
            "UPDATE organization_status SET status = 'SUSPENDED' WHERE organization_id = $1",
            [a.id],
          ),
        ).rejects.toThrow(/permission denied/);
        await migratorDatabase!.pool.query(
          "UPDATE organization_status SET status = 'SUSPENDED', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
          [a.id],
        );
        const suspended = await get(a.id);
        expect(suspended.status).toBe(403);
        expect(await suspended.json()).toMatchObject({
          code: 'ORGANIZATION_SUSPENDED',
        });
        await deniedMutation(403, ownerCookie);
        expect((await get(b.id)).status).toBe(200);
        await migratorDatabase!.pool.query(
          "UPDATE organization_status SET status = 'ACTIVE', status_version = status_version + 1, status_changed_at = now() WHERE organization_id = $1",
          [a.id],
        );
        expect((await get(a.id)).status).toBe(200);

        cookie = '';
        const outsiderPassword = randomBytes(24).toString('hex');
        const outsider = (
          await client.signUp.email({
            email: 'context-outsider@example.test',
            password: outsiderPassword,
            name: 'Outsider',
          })
        ).data!;
        await migratorDatabase!.pool.query(
          'UPDATE public."user" SET email_verified = true WHERE id = $1',
          [outsider.user.id],
        );
        expect(
          (
            await client.signIn.email({
              email: 'context-outsider@example.test',
              password: outsiderPassword,
            })
          ).error,
        ).toBeNull();
        const outsiderCookie = cookie;
        expect((await get(a.id)).status).toBe(403);
        await deniedMutation(403, outsiderCookie);
        const membership = await runtime.auth.api.addMember({
          headers: new Headers({ cookie: ownerCookie }),
          body: {
            organizationId: a.id,
            userId: outsider.user.id,
            role: 'member',
          },
        });
        expect((await get(a.id)).status).toBe(200);
        cookie = ownerCookie;
        expect(
          (
            await client.organization.updateMemberRole({
              organizationId: a.id,
              memberId: membership.id,
              role: 'admin',
            })
          ).error,
        ).toBeNull();
        const authorizedResource = await seed(contextA);
        expect(
          (await remove(a.id, authorizedResource.id, outsiderCookie)).status,
        ).toBe(204);
        expect(
          (
            await client.organization.createRole({
              organizationId: a.id,
              role: 'creator-only',
              permission: { project: ['create'] },
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await client.organization.updateMemberRole({
              organizationId: a.id,
              memberId: membership.id,
              role: 'creator-only',
            })
          ).error,
        ).toBeNull();
        expect((await get(a.id, outsiderCookie)).status).toBe(403);
        await deniedMutation(403, outsiderCookie);
        // 恢复动作权限后再撤销成员，证明拒绝来自成员撤销而非原角色限制。
        expect(
          (
            await client.organization.updateMemberRole({
              organizationId: a.id,
              memberId: membership.id,
              role: 'admin',
            })
          ).error,
        ).toBeNull();
        expect(
          (
            await client.organization.removeMember({
              organizationId: a.id,
              memberIdOrEmail: membership.id,
            })
          ).error,
        ).toBeNull();
        expect((await get(a.id, outsiderCookie)).status).toBe(403);
        await deniedMutation(403, outsiderCookie);
        await runtime.auth.api.addMember({
          headers: new Headers({ cookie: ownerCookie }),
          body: {
            organizationId: a.id,
            userId: outsider.user.id,
            role: 'admin',
          },
        });
        cookie = outsiderCookie;
        expect((await client.signOut()).error).toBeNull();
        expect((await get(a.id, outsiderCookie)).status).toBe(401);
        await deniedMutation(401, outsiderCookie);
      } finally {
        cookie = ownerCookie;
        await probe.close();
      }
    });

    it('客户端登出后旧 Cookie 无法恢复会话，错误密码不签发会话', async () => {
      expect((await client.signOut()).error).toBeNull();
      const response = await fetch(`${baseURL}/api/auth/get-session`, {
        headers: { cookie: revokedCookie },
      });
      expect(await response.json()).toBeNull();
      expect(
        await app!
          .get(IdentityService)
          .getIdentity(new Headers({ cookie: revokedCookie })),
      ).toBeNull();
      await expect(
        app!
          .get(AuthorizationService)
          .requirePermission(
            new Headers({ cookie: revokedCookie }),
            '00000000-0000-4000-8000-000000000001',
            { project: ['read'] },
          ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
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
