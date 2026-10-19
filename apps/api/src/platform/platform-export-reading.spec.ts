import type { PlatformExportFilters } from '@workspace/contracts';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformAudit } from './platform-audit';
import { PlatformIdentityManagement } from './platform-identity-management';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformUsers } from './platform-users';

const actor: PlatformPrincipal = {
  userId: 'user-a',
  sessionId: 'session-a',
  roles: [],
  permissions: [],
  scope: 'global',
  mfaVerifiedAt: null,
};
const page = { page: 2, pageSize: 17 };
const window = {
  from: '2026-10-01T00:00:00.123456+00:00',
  to: '2026-10-19T00:00:00.654321+00:00',
};
type Readers = ReturnType<typeof readers>;
function readers(runtime: AuthRuntime) {
  return {
    users: new PlatformUsers(runtime),
    organizations: new PlatformOrganizations(runtime),
    identity: new PlatformIdentityManagement(
      runtime,
      'https://example.test/reset',
    ),
    audit: new PlatformAudit(runtime),
  };
}
const cases: Array<{
  name: string;
  readFunction: string;
  exportFunction: string;
  filters: PlatformExportFilters;
  read: (modules: Readers) => Promise<unknown>;
  export: (
    modules: Readers,
    query: PlatformExportFilters & { page?: number; pageSize?: number },
    client: PoolClient,
  ) => Promise<unknown>;
}> = [
  {
    name: '用户',
    readFunction: 'list_platform_users',
    exportFunction: 'export_platform_users_page',
    filters: { q: 'selected user' },
    read: ({ users }) =>
      users.list(actor, { ...page, q: 'selected user' }, 'read-request'),
    export: ({ users }, query, client) =>
      users.exportPage(actor, query, 'read-request', client),
  },
  {
    name: '组织',
    readFunction: 'list_platform_organizations',
    exportFunction: 'export_platform_organizations_page',
    filters: {
      q: 'selected organization',
      status: 'ACTIVE',
      sortBy: 'name',
      sortOrder: 'asc',
    },
    read: ({ organizations }) =>
      organizations.list(
        actor,
        {
          ...page,
          q: 'selected organization',
          status: 'ACTIVE',
          sortBy: 'name',
          sortOrder: 'asc',
        },
        'read-request',
      ),
    export: ({ organizations }, query, client) =>
      organizations.exportPage(actor, query, 'read-request', client),
  },
  {
    name: '用户会话',
    readFunction: 'list_platform_sessions',
    exportFunction: 'export_platform_sessions_page',
    filters: { q: 'selected session', userId: 'selected-user' },
    read: ({ identity }) =>
      identity.sessions(
        actor,
        { ...page, q: 'selected session', userId: 'selected-user' },
        'read-request',
      ),
    export: ({ identity }, query, client) =>
      identity.exportSessionsPage(actor, query, 'read-request', client),
  },
  {
    name: '登录日志',
    readFunction: 'list_platform_login_logs',
    exportFunction: 'export_platform_login_logs_page',
    filters: {
      q: 'selected login',
      userId: 'selected-user',
      result: 'succeeded',
      method: 'email',
      ...window,
    },
    read: ({ identity }) =>
      identity.loginEvents(
        actor,
        {
          ...page,
          q: 'selected login',
          userId: 'selected-user',
          result: 'succeeded',
          method: 'email',
          ...window,
        },
        'read-request',
      ),
    export: ({ identity }, query, client) =>
      identity.exportLoginEventsPage(actor, query, 'read-request', client),
  },
  {
    name: '操作日志',
    readFunction: 'list_platform_audit_events',
    exportFunction: 'export_platform_audit_events_page',
    filters: {
      organizationId: 'selected-org',
      actorId: 'selected-actor',
      eventCode: 'platform.user_created',
      result: 'succeeded',
      ...window,
    },
    read: ({ audit }) =>
      audit.list(
        actor,
        {
          ...page,
          organizationId: 'selected-org',
          actorId: 'selected-actor',
          eventCode: 'platform.user_created',
          result: 'succeeded',
          ...window,
        },
        'read-request',
      ),
    export: ({ audit }, query, client) =>
      audit.exportPage(actor, query, 'read-request', client),
  },
];
function setup() {
  const projection = { items: [{ id: 'result' }], total: 1, ...page, window };
  const pool = {
    query: vi.fn().mockResolvedValue({ rows: [{ result: projection }] }),
  };
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [{ result: projection }] }),
    release: vi.fn(),
  };
  const modules = readers({ pool } as unknown as AuthRuntime);
  return { modules, pool, client, projection };
}

describe('平台领域读取与导出', () => {
  it.each(cases)(
    '$name 共用筛选解释，分别调用固定授权函数并保留任务持锁连接',
    async (entry) => {
      const { modules, pool, client, projection } = setup();
      const query = { ...entry.filters, ...page };
      const snapshot = structuredClone(query);
      await expect(entry.read(modules)).resolves.toBe(projection);
      await expect(
        entry.export(modules, query, client as unknown as PoolClient),
      ).resolves.toBe(projection);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(client.query).toHaveBeenCalledTimes(1);
      expect(pool.query.mock.calls[0][0]).toContain(
        `public.${entry.readFunction}(`,
      );
      expect(client.query.mock.calls[0][0]).toContain(
        `public.${entry.exportFunction}(`,
      );
      expect(client.query.mock.calls[0][1]).toEqual(
        pool.query.mock.calls[0][1],
      );
      expect(query).toEqual(snapshot);
      expect(client.release).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    '$name 将原始导出错误交还任务，不走普通读取的错误和失败审计路径',
    async (entry) => {
      const { modules, pool, client } = setup();
      const failure = Object.assign(new Error('FORBIDDEN'), { code: 'P0001' });
      client.query.mockRejectedValue(failure);
      await expect(
        entry.export(modules, entry.filters, client as unknown as PoolClient),
      ).rejects.toBe(failure);
      expect(pool.query).not.toHaveBeenCalled();
      expect(client.release).not.toHaveBeenCalled();
    },
  );

  it('组织导出保留原页大小与排序默认值，不改写提交筛选', async () => {
    const { modules, client } = setup();
    const query = { q: 'organization' };
    await modules.organizations.exportPage(
      actor,
      query,
      'request',
      client as unknown as PoolClient,
    );
    expect(client.query.mock.calls[0][1]).toEqual([
      actor.userId,
      actor.sessionId,
      query.q,
      null,
      1,
      100,
      'createdAt',
      'desc',
      'request',
    ]);
    expect(query).toEqual({ q: 'organization' });
  });
});
