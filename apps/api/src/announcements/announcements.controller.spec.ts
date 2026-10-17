import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import sharp from 'sharp';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { configureApp } from '../http/configure-app';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import {
  PlatformAccessService,
  type PlatformPrincipal,
} from '../platform/platform-access.service';
import { PlatformGuard } from '../platform/platform.guard';
import { PlatformResources } from '../platform-resources/platform-resources';
import type {
  OpenPlatformResource,
  PlatformResource,
  PlatformResourceInput,
} from '../platform-resources/platform-resource';
import { normalizeFileName } from '@workspace/contracts/file-path';
import { Announcements } from './announcements';
import {
  PlatformAnnouncementInboxController,
  PlatformAnnouncementsController,
} from './announcements.controller';

const actor: PlatformPrincipal = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  scope: 'global',
  roles: [],
  permissions: [],
  mfaVerifiedAt: null,
};
const content = Buffer.from('%PDF-1.7\nprivate announcement\n');
const resource: PlatformResource = {
  id: randomUUID(),
  purpose: 'announcement',
  uploadedBy: actor.userId,
  name: 'notice.pdf',
  mimeType: 'application/pdf',
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
  createdAt: '2026-10-17T00:00:00.000Z',
};
type Query = (
  sql: string,
  values: unknown[],
) => Promise<{ rows: { result: unknown }[] }>;

describe('公告 HTTP 媒体契约', () => {
  let app: INestApplication;
  const origin = 'http://localhost:3201';
  const query = vi.fn<Query>();
  const requireAccess = vi.fn().mockResolvedValue(actor);
  const create = vi.fn<PlatformResources['create']>();
  const openInternal = vi.fn<(id: string) => Promise<OpenPlatformResource>>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        PlatformAnnouncementsController,
        PlatformAnnouncementInboxController,
      ],
      providers: [
        Announcements,
        PlatformGuard,
        {
          provide: AuthRuntime,
          useValue: { pool: { query }, trustedOrigins: [origin] },
        },
        {
          provide: IdentityService,
          useValue: { requireIdentity: vi.fn().mockResolvedValue(actor) },
        },
        {
          provide: PlatformAccessService,
          useValue: { requireAccess, recordDenial: vi.fn() },
        },
        { provide: PlatformResources, useValue: { create, openInternal } },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app, () => Promise.resolve('zh-CN'));
    await app.init();
  });

  afterAll(async () => app?.close());
  beforeEach(() => {
    query
      .mockReset()
      .mockResolvedValue({ rows: [{ result: { id: resource.id } }] });
    requireAccess.mockReset().mockResolvedValue(actor);
    create
      .mockReset()
      .mockImplementation(
        async (_actor, _purpose, input: PlatformResourceInput) => {
          const chunks: Buffer[] = [];
          for await (const chunk of input.source)
            chunks.push(Buffer.from(chunk));
          expect(Buffer.concat(chunks)).toEqual(content);
          return resource;
        },
      );
    openInternal.mockReset().mockImplementation(() =>
      Promise.resolve({
        resource,
        read: {
          body: Readable.from([content]),
          bytes: content.length,
          totalBytes: content.length,
        },
      }),
    );
  });

  it('使用原始 multipart 流上传并返回公告不可变资源引用', async () => {
    const result = await request(app.getHttpServer() as Server)
      .post('/api/v1/platform/announcements/media')
      .set('Origin', origin)
      .attach('file', content, {
        filename: 'notice.pdf',
        contentType: 'application/pdf',
      });
    expect(result.status).toBe(201);
    expect(result.body as unknown).toEqual({
      fileId: resource.id,
      versionId: resource.id,
      name: resource.name,
      mimeType: resource.mimeType,
      byteSize: resource.bytes,
    });
    expect(create.mock.calls[0].slice(0, 2)).toEqual([actor, 'announcement']);
  });

  it.each([
    ['验收.txt', 'text/plain'],
    ['中文头像.png', 'image/png'],
  ])(
    'HTTP 上传的中文文件名 %s 可通过存储名称校验并原样返回',
    async (name, mimeType) => {
      const fileContent =
        mimeType === 'image/png'
          ? await sharp({
              create: {
                width: 2,
                height: 2,
                channels: 4,
                background: '#1784bc',
              },
            })
              .png()
              .toBuffer()
          : Buffer.from('公告附件内容');
      create.mockImplementationOnce(async (_actor, _purpose, input) => {
        const normalizedName = normalizeFileName(input.name);
        const chunks: Buffer[] = [];
        for await (const chunk of input.source) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks)).toEqual(fileContent);
        return {
          ...resource,
          name: normalizedName,
          mimeType: input.mimeType,
          bytes: input.bytes,
        };
      });
      const result = await request(app.getHttpServer() as Server)
        .post('/api/v1/platform/announcements/media')
        .set('Origin', origin)
        .attach('file', fileContent, { filename: name, contentType: mimeType });
      expect(result.status).toBe(201);
      expect(create.mock.calls[0][2].name).toBe(name);
      expect(result.body as unknown).toMatchObject({
        name,
        mimeType,
        byteSize: fileContent.length,
      });
    },
  );

  it('额外 multipart 字段在落入资源存储前被拒绝', async () => {
    const result = await request(app.getHttpServer() as Server)
      .post('/api/v1/platform/announcements/media')
      .set('Origin', origin)
      .field('organizationId', randomUUID())
      .attach('file', content, {
        filename: 'notice.pdf',
        contentType: 'application/pdf',
      });
    expect(result.status).toBe(400);
    expect(result.body as unknown).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(create).not.toHaveBeenCalled();
  });

  it('平台任职失效时由 Guard 拒绝上传，不执行资源写入', async () => {
    requireAccess.mockRejectedValueOnce(new ApiException(403, 'FORBIDDEN'));
    const result = await request(app.getHttpServer() as Server)
      .post('/api/v1/platform/announcements/media')
      .set('Origin', origin)
      .attach('file', content, {
        filename: 'notice.pdf',
        contentType: 'application/pdf',
      });
    expect(result.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['platform/announcements', 'platform_announcement_command'],
    ['platform/announcement-inbox', 'platform_announcement_inbox'],
  ])(
    '通过 %s 静态媒体路由输出原始字节和安全响应头',
    async (path, fixedFunction) => {
      const result = await request(app.getHttpServer() as Server).get(
        `/api/v1/${path}/media/${resource.id}?versionId=${resource.id}`,
      );
      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toBe('application/pdf');
      expect(result.headers['content-length']).toBe(String(content.length));
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(result.headers['x-content-type-options']).toBe('nosniff');
      expect(result.headers['content-disposition']).toBe(
        'attachment; filename=notice.pdf',
      );
      expect(result.body as unknown).toEqual(content);
      expect(query.mock.calls[0][0]).toContain(fixedFunction);
      expect(query.mock.calls[0][1]).toContain('media');
    },
  );

  it.each([
    ['versionId=not-a-uuid'],
    [`versionId=${resource.id}&organizationId=${randomUUID()}`],
  ])('拒绝不符合契约的媒体查询 %s', async (queryString) => {
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/announcements/media/${resource.id}?${queryString}`,
    );
    expect(result.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
    expect(openInternal).not.toHaveBeenCalled();
  });

  it('固定函数拒绝媒体访问时返回结构化 403，且不打开内容', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('FORBIDDEN'), { code: 'P0001' }),
    );
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/announcement-inbox/media/${resource.id}?versionId=${resource.id}`,
    );
    expect(result.status).toBe(403);
    expect(result.body as unknown).toMatchObject({ code: 'FORBIDDEN' });
    expect(openInternal).not.toHaveBeenCalled();
  });
});
