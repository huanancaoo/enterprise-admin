import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { announcementRepository } from '@workspace/database/repositories/announcements';
import { AuthRuntime } from '../identity/auth-runtime';
import { configureApp } from '../http/configure-app';
import { TenantGuard } from '../tenancy/tenant.guard';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { PlatformFiles } from '../platform-files/platform-files';
import { Announcements, announcementError } from './announcements';
import { TenantAnnouncementsController } from './announcements.controller';

const context: TenantContext = {
  organizationId: randomUUID(),
  userId: randomUUID(),
  membershipId: randomUUID(),
  requestId: 'announcement-tenant-error',
  locale: 'zh-CN',
};
const announcementId = randomUUID();
const publicationId = randomUUID();
const databaseError = (message: string, code = 'P0001') =>
  Object.assign(new Error(message), { code });

function fixture() {
  const control = { failure: databaseError('NOT_FOUND') };
  const statements: string[] = [];
  const query = vi.fn((statement: string | { text: string }) => {
    const text = typeof statement === 'string' ? statement : statement.text;
    statements.push(text);
    if (text.includes('public.platform_announcement_inbox'))
      return Promise.reject(control.failure);
    return Promise.resolve({ rows: [] });
  });
  const runtime = { pool: { query } } as unknown as AuthRuntime;
  const openInternal =
    vi.fn<() => ReturnType<PlatformFiles['openReference']>>();
  const resources = {
    openReference: async (authorize: () => Promise<unknown>) => {
      await authorize();
      return openInternal();
    },
  } as unknown as PlatformFiles;
  return { control, statements, runtime, resources, openInternal };
}

describe('租户公告 Drizzle 业务错误', () => {
  it('真实 TenantRunner 与 Repository 查询将 PostgreSQL 错误包装到 Drizzle cause', async () => {
    const { runtime, control, statements } = fixture();
    // 保留真正的 Drizzle 事务与查询执行，只替换最底层 pg I/O。
    const running = createTenantRunner(runtime.pool)(context, (tx) =>
      announcementRepository.inbox(tx, 'get', announcementId, {}),
    );
    await expect(running).rejects.toMatchObject({ cause: control.failure });
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('rollback');
  });

  it.each([
    ['get', 'NOT_FOUND', 404],
    ['read', 'ANNOUNCEMENT_STATE_CONFLICT', 409],
  ])(
    '通过真实 Drizzle cause 将 %s 的 %s 转为 %s',
    async (operation, code, status) => {
      const { runtime, resources, control, statements } = fixture();
      control.failure = databaseError(code);
      const service = new Announcements(runtime, resources);
      await expect(
        service.tenantInbox(
          context,
          operation,
          announcementId,
          operation === 'read' ? { publicationId } : {},
        ),
      ).rejects.toMatchObject({ status, response: { code } });
      expect(
        statements.some((text) =>
          text.includes("set_config('app.organization_id'"),
        ),
      ).toBe(true);
      expect(statements.at(-1)).toBe('rollback');
    },
  );

  it.each([
    ['NOT_FOUND', '23514'],
    ['PRIVATE_DATABASE_DETAIL', 'P0001'],
  ])(
    '不把未约定的 PostgreSQL 错误 %s/%s 改写为业务错误',
    async (message, code) => {
      const wrapper = new Error('Failed query', {
        cause: databaseError(message, code),
      });
      await expect(
        Promise.resolve().then(() => announcementError(wrapper)),
      ).rejects.toBe(wrapper);
    },
  );
});

describe('租户公告 HTTP 业务错误', () => {
  let app: INestApplication;
  const { runtime, resources, control, statements, openInternal } = fixture();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TenantAnnouncementsController],
      providers: [
        Announcements,
        TenantGuard,
        { provide: AuthRuntime, useValue: runtime },
        { provide: PlatformFiles, useValue: resources },
        {
          provide: TenantContextService,
          useValue: { resolveMembership: vi.fn().mockResolvedValue(context) },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app, () => Promise.resolve('zh-CN'));
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    control.failure = databaseError('NOT_FOUND');
    statements.length = 0;
    openInternal.mockClear();
  });

  it('草稿或撤回公告的真实租户读取路由返回 404', async () => {
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/organizations/${context.organizationId}/announcements/${announcementId}`,
    );
    expect(result.status).toBe(404);
    expect(result.body as unknown).toMatchObject({ code: 'NOT_FOUND' });
    expect(statements.at(-1)).toBe('rollback');
  });

  it('旧发布批次的已读请求经 Drizzle 返回 409', async () => {
    control.failure = databaseError('ANNOUNCEMENT_STATE_CONFLICT');
    const result = await request(app.getHttpServer() as Server)
      .post(
        `/api/v1/organizations/${context.organizationId}/announcements/${announcementId}/read`,
      )
      .send({ publicationId });
    expect(result.status).toBe(409);
    expect(result.body as unknown).toMatchObject({
      code: 'ANNOUNCEMENT_STATE_CONFLICT',
    });
    expect(
      statements.some((text) => text.includes('require_active_organization')),
    ).toBe(true);
    expect(statements.at(-1)).toBe('rollback');
  });

  it('租户素材读取被领域拒绝时返回 404 且不打开物理内容', async () => {
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/organizations/${context.organizationId}/announcements/media/${announcementId}?versionId=${announcementId}`,
    );
    expect(result.status).toBe(404);
    expect(result.body as unknown).toMatchObject({ code: 'NOT_FOUND' });
    expect(openInternal).not.toHaveBeenCalled();
  });
});
