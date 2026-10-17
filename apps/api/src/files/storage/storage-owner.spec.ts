import { describe, expect, it } from 'vitest';
import { assertSameOwner, platformStorageOwner, storageKey } from './storage';

describe('平台物理资源命名空间', () => {
  it('组织、个人、平台即使 UUID 相同也使用独立目录，供 Local 和 S3 共用', () => {
    const address = { area: 'files' as const, segments: ['resource'] };
    expect(
      ['organization', 'personal', 'platform'].map((kind) =>
        storageKey({
          ...address,
          owner: {
            kind: kind as 'organization' | 'personal' | 'platform',
            id: platformStorageOwner.id,
          },
        }),
      ),
    ).toEqual([
      `organizations/${platformStorageOwner.id}/files/resource`,
      `users/${platformStorageOwner.id}/files/resource`,
      `platforms/${platformStorageOwner.id}/files/resource`,
    ]);
  });

  it('平台 owner 必须使用固定 namespace，不能借员工或组织 UUID 新建平台域', () => {
    expect(() =>
      storageKey({
        owner: { kind: 'platform', id: '01900000-0000-7000-8000-000000000002' },
        area: 'files',
        segments: ['resource'],
      }),
    ).toThrow('STORAGE_LOCATION_INVALID');
    expect(() =>
      assertSameOwner(
        { owner: platformStorageOwner, area: 'files', segments: ['resource'] },
        {
          owner: { kind: 'organization', id: platformStorageOwner.id },
          area: 'files',
          segments: ['resource'],
        },
      ),
    ).toThrow('STORAGE_OWNER_MISMATCH');
  });
});
