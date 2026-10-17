import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import {
  measuredContent,
  platformStorageOwner,
  storageKey,
  type FileStorage,
  type StorageAddress,
} from '../files/storage/storage';
import { PlatformResources } from './platform-resources';
import type { PlatformResource } from './platform-resource';

const actor = {
  userId: '01900000-0000-7000-8000-000000000002',
  sessionId: '01900000-0000-7000-8000-000000000003',
};
const content = Buffer.from('private workbook content');
const sha256 = createHash('sha256').update(content).digest('hex');
const metadata: PlatformResource = {
  id: '01900000-0000-7000-8000-000000000004',
  purpose: 'task-output',
  uploadedBy: actor.userId,
  name: 'report.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bytes: content.length,
  sha256,
  createdAt: '2026-10-17T00:00:00.000Z',
};
const databaseFailure = (message: string) =>
  Object.assign(new Error(message), { code: 'P0001' });
const input = () => ({
  name: metadata.name,
  mimeType: metadata.mimeType,
  bytes: content.length,
  source: Readable.from([content]),
});

function setup() {
  const client = {
    query: vi
      .fn<
        (
          statement: string,
          values?: unknown[],
        ) => Promise<{ rows: { result: PlatformResource }[] }>
      >()
      .mockResolvedValue({ rows: [{ result: metadata }] }),
    release: vi.fn(),
  };
  const pool = {
    query: vi
      .fn<
        (
          statement: string,
          values?: unknown[],
        ) => Promise<{ rows: { result: PlatformResource }[] }>
      >()
      .mockResolvedValue({ rows: [{ result: metadata }] }),
    connect: vi.fn().mockResolvedValue(client),
  };
  const storage = {
    ensureOwner: vi.fn().mockResolvedValue(undefined),
    write: vi.fn(
      async (
        _address: StorageAddress,
        source: AsyncIterable<Uint8Array>,
        bytes: number,
      ) => {
        const measured = measuredContent(source, bytes);
        for await (const chunk of measured.stream) void chunk;
        return measured.facts();
      },
    ),
    remove: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({
      body: Readable.from([content]),
      bytes: content.length,
      totalBytes: content.length,
    }),
  };
  const service = new PlatformResources(
    { pool } as unknown as AuthRuntime,
    new FilesRuntime(storage as unknown as FileStorage),
  );
  return { service, pool, client, storage };
}

describe('平台私有资源边界', () => {
  it('物理归属独立于上传者，持久化实际测得的长度和 SHA256', async () => {
    const { service, pool, client, storage } = setup();
    await expect(
      service.create(actor, 'task-output', input(), 'upload-request'),
    ).resolves.toEqual(metadata);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT public.prepare_platform_resource($1,$2,$3)',
      [actor.userId, actor.sessionId, 'task-output'],
    );
    const [address] = storage.write.mock.calls[0];
    expect(address).toMatchObject({ owner: platformStorageOwner });
    expect(storageKey(address)).toMatch(
      /^platforms\/00000000-0000-4000-8000-000000000001\/files\/[0-9a-f-]{36}$/,
    );
    expect(client.query.mock.calls.map(([statement]) => statement)).toEqual([
      'BEGIN',
      'SELECT public.create_platform_resource($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
      'COMMIT',
    ]);
    expect(client.query.mock.calls[1][1]).toEqual([
      actor.userId,
      actor.sessionId,
      address.segments[0],
      'task-output',
      metadata.name,
      metadata.mimeType,
      content.length,
      sha256,
      'upload-request',
    ]);
  });

  it('上传前没有当前权限时不消费输入或触碰物理存储', async () => {
    const { service, pool, storage } = setup();
    pool.query.mockRejectedValueOnce(databaseFailure('FORBIDDEN'));
    await expect(
      service.create(actor, 'task-input', input(), 'denied-request'),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(storage.ensureOwner).not.toHaveBeenCalled();
    expect(storage.write).not.toHaveBeenCalled();
  });

  it.each(['FORBIDDEN', 'AUDIT_UNAVAILABLE'])(
    '内容写入后的 %s 会回滚元数据并删除未提交内容',
    async (code) => {
      const { service, client, storage } = setup();
      client.query.mockImplementation((statement) =>
        statement.startsWith('SELECT')
          ? Promise.reject(databaseFailure(code))
          : Promise.resolve({ rows: [] }),
      );
      await expect(
        service.create(actor, 'announcement', input(), 'revoked-request'),
      ).rejects.toMatchObject({ response: { code } });
      expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      expect(storage.remove).toHaveBeenCalledWith(
        storage.write.mock.calls[0][0],
      );
    },
  );

  it('COMMIT 断连结果不确定时保留可能已提交的资源内容', async () => {
    const { service, client, storage } = setup();
    client.query.mockImplementation((statement) =>
      statement === 'COMMIT'
        ? Promise.reject(new Error('connection lost'))
        : Promise.resolve({ rows: [{ result: metadata }] }),
    );
    await expect(
      service.create(actor, 'task-output', input(), 'ambiguous-commit'),
    ).rejects.toMatchObject({ response: { code: 'INTERNAL_ERROR' } });
    expect(storage.remove).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('读取授权失败或审计失败时不打开内容流', async () => {
    const { service, pool, storage } = setup();
    pool.query.mockRejectedValueOnce(databaseFailure('FORBIDDEN'));
    await expect(
      service.getForActor(actor, metadata.id, 'read-denied'),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('公告完成领域授权后可使用内部入口读取资源且没有组织上下文', async () => {
    const { service, pool, storage } = setup();
    const opened = await service.openInternal(metadata.id);
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT public.get_platform_resource_internal($1) AS result',
      [metadata.id],
    );
    expect(storage.open).toHaveBeenCalledWith({
      owner: platformStorageOwner,
      area: 'files',
      segments: [metadata.id],
    });
    expect(opened.resource).toEqual(metadata);
    opened.read.body.destroy();
  });

  it('物理内容长度不符时关闭流并拒绝返回', async () => {
    const { service, storage } = setup();
    const body = Readable.from([Buffer.from('truncated')]);
    storage.open.mockResolvedValueOnce({
      body,
      bytes: 9,
      totalBytes: 9,
    });
    await expect(service.openInternal(metadata.id)).rejects.toMatchObject({
      response: { code: 'FILE_CONTENT_MISMATCH' },
    });
    expect(body.destroyed).toBe(true);
  });
});
