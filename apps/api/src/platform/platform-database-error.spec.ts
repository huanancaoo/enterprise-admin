import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformAudit } from './platform-audit';
import { PlatformUsers } from './platform-users';
import { PlatformSettings } from './platform-settings';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformIdentityManagement } from './platform-identity-management';
import { PlatformStoragePolicyService } from './platform-storage-policy';
import { PlatformSystemDatabase } from './platform-system/database';
import { rethrowPlatformDatabaseError } from './platform-database-error';

const actor: PlatformPrincipal = {
  userId: '2a5e0ba1-1aa5-4fbd-8517-8c0131e3039c',
  sessionId: 'session-a',
  roles: [],
  permissions: [],
  scope: 'global',
  mfaVerifiedAt: null,
};
const calls: Array<[string, (runtime: AuthRuntime) => Promise<unknown>]> = [
  [
    'audit',
    (runtime) => new PlatformAudit(runtime).get(actor, 'event', 'request'),
  ],
  [
    'users',
    (runtime) => new PlatformUsers(runtime).get(actor, 'user', 'request'),
  ],
  [
    'settings',
    (runtime) =>
      new PlatformSettings(runtime, {
        environment: 'test',
        applicationVersion: 'test',
        smtpConfigured: false,
      }).get(actor, 'request'),
  ],
  [
    'organizations',
    (runtime) =>
      new PlatformOrganizations(runtime).get(actor, 'org', 'request'),
  ],
  [
    'identity',
    (runtime) =>
      new PlatformIdentityManagement(
        runtime,
        'https://example.test/reset',
      ).sessions(actor, { page: 1, pageSize: 20 }, 'request'),
  ],
  [
    'system',
    (runtime) =>
      new PlatformSystemDatabase(runtime.pool).bind('identity', 'role')(
        actor,
        'get',
        'role',
        {},
        'request',
        z.unknown(),
      ),
  ],
];
const databaseError = (message: string, code = 'P0001') =>
  Object.assign(new Error(message), { code });

function runtimeFailure(error: unknown) {
  const query = vi
    .fn()
    .mockRejectedValueOnce(error)
    .mockResolvedValue({ rows: [] });
  return { query, runtime: { pool: { query } } as unknown as AuthRuntime };
}

describe('平台数据库公开错误边界', () => {
  it.each(calls)('%s 保留已允许的拒绝码', async (_name, call) => {
    const { runtime } = runtimeFailure(databaseError('FORBIDDEN'));
    await expect(call(runtime)).rejects.toMatchObject({
      status: 403,
      response: { code: 'FORBIDDEN' },
    });
  });

  it.each(calls)('%s 透传非本通道白名单错误的原对象', async (_name, call) => {
    const failure = databaseError('FILE_TOO_LARGE');
    const { runtime } = runtimeFailure(failure);
    await expect(call(runtime)).rejects.toBe(failure);
  });

  it.each([
    databaseError('FORBIDDEN', '23505'),
    databaseError('private database message'),
    { code: 'P0001', message: 'FORBIDDEN' },
  ])('保留非业务异常对象，不能仅凭文本公开错误', (failure) => {
    expect.assertions(1);
    try {
      rethrowPlatformDatabaseError(failure, { FORBIDDEN: 403 });
    } catch (caught) {
      expect(caught).toBe(failure);
    }
  });

  it('保留身份管理和系统管理各自原有的 immutable 状态值', async () => {
    const identity = runtimeFailure(databaseError('BUILT_IN_ROLE_IMMUTABLE'));
    await expect(calls[4][1](identity.runtime)).rejects.toMatchObject({
      status: 403,
    });
    const system = runtimeFailure(databaseError('BUILT_IN_ROLE_IMMUTABLE'));
    await expect(calls[5][1](system.runtime)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('组织拒绝在转换后按原顺序审计，400 不记录失败', async () => {
    const rejected = runtimeFailure(databaseError('FORBIDDEN'));
    await expect(
      new PlatformOrganizations(rejected.runtime).get(actor, 'org', 'request'),
    ).rejects.toMatchObject({ status: 403 });
    expect(rejected.query.mock.calls.map(([sql]) => String(sql))).toEqual([
      expect.stringContaining('get_platform_organization'),
      expect.stringContaining('record_platform_organization_failure'),
    ]);
    const invalid = runtimeFailure(databaseError('VALIDATION_ERROR'));
    await expect(
      new PlatformOrganizations(invalid.runtime).get(actor, 'org', 'request'),
    ).rejects.toMatchObject({ status: 400 });
    expect(invalid.query).toHaveBeenCalledTimes(1);
  });

  it('存储策略仍将未知错误投影为 INTERNAL_ERROR 并先记录失败', async () => {
    const { query, runtime } = runtimeFailure(databaseError('FILE_TOO_LARGE'));
    await expect(
      new PlatformStoragePolicyService(runtime).get(actor, 'org', 'request'),
    ).rejects.toMatchObject({
      status: 500,
      response: { code: 'INTERNAL_ERROR' },
    });
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('record_platform_storage_policy_failure'),
      [actor.userId, 'org', 'get', 'INTERNAL_ERROR', 'request'],
    );
  });
});
