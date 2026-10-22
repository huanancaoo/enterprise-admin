import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '@workspace/database/tenant';
import { ApiException } from '../http/api-exception';
import type { AuthRuntime } from '../identity/auth-runtime';
import type { z } from 'zod';
import {
  PlatformFiles,
  PlatformFileMediaSchema,
} from '../platform-files/platform-files';
type PlatformResource = z.infer<typeof PlatformFileMediaSchema>['resource'];
type OpenPlatformResource = Awaited<ReturnType<PlatformFiles['openReference']>>;
const attachment = (resource: PlatformResource) => ({
  fileId: resource.id,
  versionId: resource.versionId,
  name: resource.name,
  mimeType: resource.mimeType,
  byteSize: resource.bytes,
});
const projection = (resource: PlatformResource) => ({
  resource,
  area: 'files' as const,
  path: [resource.name],
});

import { Announcements } from './announcements';

const actor = { userId: randomUUID(), sessionId: randomUUID() };
const context: TenantContext = {
  userId: actor.userId,
  organizationId: randomUUID(),
  membershipId: randomUUID(),
  requestId: 'tenant-media',
  locale: 'zh-CN',
};
const content = Buffer.from('private announcement content');
const metadata: PlatformResource = {
  id: randomUUID(),
  versionId: randomUUID(),
  name: 'notice.pdf',
  mimeType: 'application/pdf',
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
};
const databaseFailure = (message: string) =>
  Object.assign(new Error(message), { code: 'P0001' });

function setup(resource: PlatformResource = metadata, body = content) {
  const storageBody = Readable.from([body]);
  const query = vi
    .fn<
      (
        sql: string,
        values?: unknown[],
      ) => Promise<{ rows: { result: unknown }[] }>
    >()
    .mockResolvedValue({ rows: [{ result: projection(resource) }] });
  const openInternal = vi
    .fn<() => Promise<OpenPlatformResource>>()
    .mockResolvedValue({
      resource,
      read: { body: storageBody, bytes: body.length, totalBytes: body.length },
    });
  const create = vi
    .fn<PlatformFiles['uploadAnnouncement']>()
    .mockResolvedValue(attachment(resource));
  const service = new Announcements(
    { pool: { query } } as unknown as AuthRuntime,
    {
      uploadAnnouncement: create,
      openReference: async (authorize: () => Promise<unknown>) => {
        await authorize();
        return openInternal();
      },
    } as unknown as PlatformFiles,
  );
  const setHeader = vi.fn();
  const response = Object.assign(new EventEmitter(), {
    locals: { requestId: 'announcement-media' },
    setHeader,
    destroy: vi.fn(),
  }) as unknown as Response;
  return {
    service,
    query,
    openInternal,
    create,
    response,
    storageBody,
    setHeader,
  };
}

async function bytes(source: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function uploadRequest(): Request {
  const boundary = `announcement-${randomUUID()}`;
  return Object.assign(
    Readable.from([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notice.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    {
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    },
  ) as unknown as Request;
}

describe('公告私有素材读取', () => {
  it.each([false, true])(
    '平台读取先完成当前领域授权，管理入口=%s',
    async (management) => {
      const { service, query, openInternal, response } = setup();
      const file = await service.media(
        actor,
        null,
        metadata.id,
        metadata.id,
        response,
        management,
      );
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(
          management
            ? 'platform_announcement_command'
            : 'platform_announcement_inbox',
        ),
        management
          ? [
              actor.userId,
              actor.sessionId,
              'media',
              metadata.id,
              JSON.stringify({ versionId: metadata.id }),
              'announcement-media',
            ]
          : [
              actor.userId,
              actor.sessionId,
              null,
              'media',
              metadata.id,
              JSON.stringify({ versionId: metadata.id }),
              'announcement-media',
            ],
      );
      expect(query.mock.invocationCallOrder[0]).toBeLessThan(
        openInternal.mock.invocationCallOrder[0],
      );
      await expect(bytes(file.getStream())).resolves.toEqual(content);
    },
  );

  it.each(['FORBIDDEN', 'AUDIT_UNAVAILABLE'])(
    '领域读取返回 %s 时不打开物理内容',
    async (code) => {
      const { service, query, openInternal, response } = setup();
      query.mockRejectedValueOnce(databaseFailure(code));
      await expect(
        service.media(actor, null, metadata.id, metadata.id, response),
      ).rejects.toMatchObject({ response: { code } });
      expect(openInternal).not.toHaveBeenCalled();
    },
  );

  it('租户素材读取必须先通过带组织上下文的公告可见性检查', async () => {
    const { service, openInternal, response } = setup();
    const tenantInbox = vi
      .spyOn(service, 'tenantInbox')
      .mockResolvedValueOnce(projection(metadata));
    const file = await service.tenantMedia(
      context,
      metadata.id,
      metadata.id,
      response,
    );
    expect(tenantInbox).toHaveBeenCalledWith(context, 'media', metadata.id, {
      versionId: metadata.id,
    });
    expect(tenantInbox.mock.invocationCallOrder[0]).toBeLessThan(
      openInternal.mock.invocationCallOrder[0],
    );
    await expect(bytes(file.getStream())).resolves.toEqual(content);
  });

  it('租户离开组织或公告撤回后不再打开内容', async () => {
    const { service, openInternal, response } = setup();
    vi.spyOn(service, 'tenantInbox').mockRejectedValueOnce(
      new ApiException(404, 'NOT_FOUND'),
    );
    await expect(
      service.tenantMedia(context, metadata.id, metadata.id, response),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(openInternal).not.toHaveBeenCalled();
  });

  it('将独立版本身份交给公告授权入口校验', async () => {
    const { service, query, response } = setup();
    const file = await service.media(
      actor,
      null,
      metadata.id,
      metadata.versionId,
      response,
    );
    expect(query.mock.calls[0][1]).toContain(
      JSON.stringify({ versionId: metadata.versionId }),
    );
    await expect(bytes(file.getStream())).resolves.toEqual(content);
  });

  it.each([
    ['application/pdf', 'attachment'],
    ['image/png', 'inline'],
  ])(
    '使用私有无缓存、禁嗅探和正确的 %s 下载方式',
    async (mimeType, disposition) => {
      const { service, response, setHeader } = setup({
        ...metadata,
        name: '平台公告.pdf',
        mimeType,
      });
      const file = await service.media(
        actor,
        null,
        metadata.id,
        metadata.id,
        response,
      );
      expect(setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'private, no-store',
      );
      expect(setHeader).toHaveBeenCalledWith(
        'X-Content-Type-Options',
        'nosniff',
      );
      expect(file.getHeaders()).toMatchObject({
        type: mimeType,
        length: content.length,
      });
      expect(file.getHeaders().disposition).toContain(`${disposition};`);
      expect(file.getHeaders().disposition).toContain('filename*=UTF-8');
      await expect(bytes(file.getStream())).resolves.toEqual(content);
    },
  );

  it.each([
    ['长度缩短', content.subarray(0, content.length - 1)],
    ['长度超出', Buffer.concat([content, Buffer.from('extra')])],
    ['同长内容被替换', Buffer.alloc(content.length, 0x61)],
  ])('检测存储内容%s并关闭原始流', async (_name, body) => {
    const { service, response, storageBody } = setup(metadata, body);
    const file = await service.media(
      actor,
      null,
      metadata.id,
      metadata.id,
      response,
    );
    await expect(bytes(file.getStream())).rejects.toThrow(
      'RESOURCE_CONTENT_MISMATCH',
    );
    expect(storageBody.destroyed).toBe(true);
  });

  it('客户端断开连接时终止内容读取并移除关闭监听器', async () => {
    const { service, response, storageBody } = setup();
    const file = await service.media(
      actor,
      null,
      metadata.id,
      metadata.id,
      response,
    );
    const closed = once(file.getStream(), 'close');
    response.emit('close');
    await closed;
    expect(file.getStream().destroyed).toBe(true);
    expect(storageBody.destroyed).toBe(true);
    expect(response.listenerCount('close')).toBe(0);
  });
});

describe('公告上传持久化和清理', () => {
  it.each([false, true])(
    '存储返回后销毁输入流并清理临时文件，存储失败=%s',
    async (failure) => {
      const { service, create } = setup();
      let path: string | undefined;
      let source: Readable | undefined;
      create.mockImplementationOnce(async (_actor, input, requestId) => {
        expect(requestId).toBe('upload-announcement');
        source = input.source;
        path = String((source as { path?: unknown }).path);
        await expect(stat(path)).resolves.toMatchObject({
          size: content.length,
        });
        if (failure) throw new ApiException(403, 'FORBIDDEN');
        await expect(bytes(input.source)).resolves.toEqual(content);
        return attachment(metadata);
      });
      const uploading = service.upload(
        actor,
        uploadRequest(),
        'upload-announcement',
      );
      if (failure)
        await expect(uploading).rejects.toMatchObject({
          response: { code: 'FORBIDDEN' },
        });
      else
        await expect(uploading).resolves.toEqual({
          fileId: metadata.id,
          versionId: metadata.versionId,
          name: metadata.name,
          mimeType: metadata.mimeType,
          byteSize: content.length,
        });
      expect(source?.destroyed).toBe(true);
      expect(path).toBeDefined();
      await expect(stat(path!)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
