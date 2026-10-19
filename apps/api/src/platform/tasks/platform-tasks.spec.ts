import type {
  PlatformExportFilters,
  PlatformExportResource,
  PlatformTask,
  PlatformTaskResult,
} from '@workspace/contracts';
import { readWorkerConfig } from '@workspace/jobs';
import {
  createPlatformEmployeeImportTemplate,
  parsePlatformEmployeeImportWorkbook,
  PLATFORM_XLSX_MEDIA_TYPE,
  writePlatformExportWorkbook,
} from '@workspace/jobs/platform-exchange';
import {
  createPlatformTaskRuntime,
  type PlatformTaskReference,
} from '@workspace/jobs/platform-runtime';
import { platformPermissions } from '@workspace/permissions';
import { verifyPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthRuntime } from '../../identity/auth-runtime';
import type { Identity } from '../../identity/identity.service';
import type {
  PlatformResourceActor,
  PlatformResourceInput,
  PlatformResourcePurpose,
} from '../../platform-resources/platform-resource';
import type { PlatformResources } from '../../platform-resources/platform-resources';
import { PlatformAudit } from '../platform-audit';
import { PlatformIdentityManagement } from '../platform-identity-management';
import { PlatformOrganizations } from '../platform-organizations';
import { PlatformUsers } from '../platform-users';
import { PlatformSystem } from '../system/platform-system';
import {
  decryptPlatformTaskCredential,
  encryptPlatformTaskCredential,
} from './platform-task-crypto';
import { PlatformTasks } from './platform-tasks';

// 测试穿过正式执行回调，Redis 调度本身由任务运行时测试覆盖。
vi.mock('@workspace/jobs/platform-runtime', () => ({
  createPlatformTaskRuntime: vi.fn(() => ({
    worker: { isRunning: () => true },
    close: vi.fn(),
  })),
}));

vi.mock('@workspace/jobs/platform-exchange', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@workspace/jobs/platform-exchange')>();
  return {
    ...actual,
    writePlatformExportWorkbook: vi.fn(actual.writePlatformExportWorkbook),
    // 行解析另有工作簿测试；只在报告映射测试注入行错误，执行器和 XLSX 输出保持真实。
    parsePlatformEmployeeImportWorkbook: vi.fn(
      actual.parsePlatformEmployeeImportWorkbook,
    ),
  };
});

type ResultRows = { rows: Array<{ result: unknown }> };
type Statement = (sql: string, params?: unknown[]) => Promise<ResultRows>;
type Command = {
  operation: string;
  id: string;
  input: Record<string, unknown>;
};
type ExportPage = {
  items: Record<string, unknown>[];
  total?: number;
  window?: { from: string; to: string };
};
const actor: Identity = { userId: randomUUID(), sessionId: randomUUID() };
const inputResourceId = randomUUID();
const outputResourceId = randomUUID();
const encryptionKey = Buffer.alloc(32, 0x77);
const initialPassword = 'employee-import-batch-password';
let template: Buffer;

function task(
  id: string = randomUUID(),
  resource: PlatformExportResource = 'employees',
  kind: PlatformTask['kind'] = 'export',
): PlatformTask {
  return {
    id,
    actorId: actor.userId,
    kind,
    resource,
    status: 'pending',
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
    errorCode: null,
    resultAvailable: false,
    result: null,
  };
}
function databaseFailure(message: string) {
  return Object.assign(new Error(message), { code: 'P0001' });
}
function setup() {
  const commands: Command[] = [];
  const events: string[] = [];
  const uploads: Array<{ purpose: PlatformResourcePurpose; bytes: Buffer }> =
    [];
  const control: {
    permissions: string[] | null;
    stored?: PlatformTask;
    fingerprint?: unknown;
    claim?: Record<string, unknown>;
    downloadError?: Error;
    page?: (sql: string, params: unknown[]) => ExportPage;
    outcome?: (params: unknown[]) => { outcome: string; code?: string };
  } = { permissions: [...platformPermissions] };
  const respond: Statement = (sql, params = []) => {
    if (sql.includes('read_platform_access')) {
      events.push('access');
      return Promise.resolve({
        rows: control.permissions ? [{ result: control.permissions }] : [],
      });
    }
    if (sql.includes('platform_task_command')) {
      const operation = String(params[2]);
      const id = String(params[3]);
      const input = JSON.parse(String(params[4])) as Record<string, unknown>;
      events.push(`command:${operation}`);
      commands.push({ operation, id, input });
      if (operation === 'find')
        return Promise.resolve({ rows: [{ result: control.stored ?? null }] });
      if (operation === 'submit') {
        if (control.stored && control.fingerprint !== input.intentFingerprint)
          return Promise.reject(databaseFailure('IDEMPOTENCY_KEY_REUSED'));
        control.fingerprint = input.intentFingerprint;
        control.stored ??= task(
          id,
          input.resource as PlatformExportResource,
          input.kind as PlatformTask['kind'],
        );
        return Promise.resolve({ rows: [{ result: control.stored }] });
      }
      if (operation === 'download') {
        if (control.downloadError) return Promise.reject(control.downloadError);
        return Promise.resolve({
          rows: [{ result: { resultResourceId: outputResourceId } }],
        });
      }
      if (operation === 'claim')
        return Promise.resolve({ rows: [{ result: control.claim }] });
      return Promise.resolve({
        rows: [{ result: control.stored ?? task(id) }],
      });
    }
    if (sql.includes('platform_task_employee_row'))
      return Promise.resolve({
        rows: [{ result: control.outcome?.(params) ?? { outcome: 'created' } }],
      });
    if (sql.includes('pg_advisory_'))
      return Promise.resolve({ rows: [{ result: null }] });
    return Promise.resolve({
      rows: [
        { result: control.page?.(sql, params) ?? { items: [], total: 0 } },
      ],
    });
  };
  const client = { query: vi.fn<Statement>(respond), release: vi.fn() };
  const pool = {
    query: vi.fn<Statement>(respond),
    connect: vi.fn().mockResolvedValue(client),
  };
  const privateResources = {
    create: vi.fn(
      async (
        _actor: PlatformResourceActor,
        purpose: PlatformResourcePurpose,
        input: PlatformResourceInput,
      ) => {
        events.push(`resource:create:${purpose}`);
        const chunks: Buffer[] = [];
        for await (const chunk of input.source) chunks.push(Buffer.from(chunk));
        uploads.push({ purpose, bytes: Buffer.concat(chunks) });
        return {
          id: purpose === 'task-input' ? inputResourceId : outputResourceId,
        };
      },
    ),
    openInternal: vi.fn((id: string) => {
      events.push(`resource:open:${id}`);
      return Promise.resolve({
        resource: { id },
        read: {
          body: Readable.from([template]),
          bytes: template.length,
          totalBytes: template.length,
        },
      });
    }),
  };
  const runtime = { pool } as unknown as AuthRuntime;
  const service = new PlatformTasks(
    runtime,
    privateResources as unknown as PlatformResources,
    {
      worker: readWorkerConfig({ REDIS_URL: 'redis://localhost:6379' }),
      encryptionKey,
    },
    new PlatformSystem(runtime),
    new PlatformUsers(runtime),
    new PlatformOrganizations(runtime),
    new PlatformIdentityManagement(runtime, 'https://example.test/reset'),
    new PlatformAudit(runtime),
  );
  const execute = (reference: PlatformTaskReference) => {
    service.start();
    return vi
      .mocked(createPlatformTaskRuntime)
      .mock.lastCall![1].execute(reference);
  };
  const executeExport = async (
    resource: PlatformExportResource,
    filters: PlatformExportFilters,
    requestId: string,
  ) => {
    const submitted = await service.export(
      actor,
      { resource, filters },
      'export-test-key',
      requestId,
    );
    control.claim = {
      ...submitted,
      status: 'running',
      sessionId: actor.sessionId,
      input: { filters },
      credentialCiphertext: null,
    };
    await execute({
      scope: 'platform',
      taskId: submitted.id,
      actorId: actor.userId,
      sessionId: actor.sessionId,
      requestId,
    });
    return commands.find((command) => command.operation === 'complete')!.input
      .result as PlatformTaskResult;
  };
  return {
    service,
    execute,
    executeExport,
    client,
    pool,
    control,
    commands,
    events,
    uploads,
    privateResources,
  };
}
const importInput = () => ({
  fileName: 'employees.xlsx',
  contentBase64: template.toString('base64'),
  initialPassword,
  updateExisting: true,
});

beforeAll(async () => {
  template = await createPlatformEmployeeImportTemplate();
});
beforeEach(() => {
  vi.mocked(parsePlatformEmployeeImportWorkbook).mockReset();
  vi.mocked(writePlatformExportWorkbook).mockClear();
  vi.mocked(createPlatformTaskRuntime).mockClear();
});

describe('平台异步任务业务链', () => {
  it('提交导出仍生成已存任务采用的原意图摘要', async () => {
    const { service, commands } = setup();
    await service.export(
      actor,
      { resource: 'employees', filters: { q: '客户', status: 'active' } },
      'fingerprint-protocol',
      'request-a',
    );
    expect(
      commands.find((command) => command.operation === 'submit')?.input
        .intentFingerprint,
    ).toBe('238696b55ff86f2323e04f809be7c1547fc3c16c4db0bdd2c17a8ec88c9f3e9c');
  });

  it('模板通过运行账号可调用的授权快照检查任职管理权限', async () => {
    const { service, pool, control } = setup();
    control.permissions = ['platform.authorization:manage'];
    await expect(service.template(actor)).resolves.toEqual(expect.any(Buffer));
    expect(pool.query).toHaveBeenCalledWith(
      'SELECT permissions AS result FROM public.read_platform_access($1,$2)',
      [actor.userId, actor.sessionId],
    );
  });

  it.each([null, [], ['platform.employee:read']])(
    '当前授权为 %j 时拒绝模板、导入与导出，不提交任务或创建文件',
    async (permissions) => {
      const { service, control, commands, privateResources } = setup();
      control.permissions = permissions;
      await expect(service.template(actor)).rejects.toMatchObject({
        status: 403,
        response: { code: 'FORBIDDEN' },
      });
      await expect(
        service.import(actor, importInput(), 'denied-import', 'request-import'),
      ).rejects.toMatchObject({ status: 403, response: { code: 'FORBIDDEN' } });
      await expect(
        service.export(
          actor,
          { resource: 'employees', filters: {} },
          'denied-export',
          'request-export',
        ),
      ).rejects.toMatchObject({ status: 403, response: { code: 'FORBIDDEN' } });
      expect(commands).toHaveLength(0);
      expect(privateResources.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['employees', 'platform.employee:export'],
    ['roles', 'platform.role:export'],
    ['menus', 'platform.menu:export'],
    ['departments', 'platform.department:export'],
    ['posts', 'platform.post:export'],
    ['dictionaries', 'platform.dictionary:export'],
    ['dictionary-items', 'platform.dictionary:export'],
    ['parameters', 'platform.parameter:export'],
    ['users', 'platform.user:export'],
    ['organizations', 'platform.organization:export'],
    ['login-events', 'platform.login:export'],
    ['sessions', 'platform.session:export'],
    ['audit-events', 'platform.audit:export'],
  ] as const)(
    '提交 %s 导出保留当前筛选，并校验原始导出动作',
    async (resource, action) => {
      const { service, pool, commands, control } = setup();
      control.permissions = [action];
      const filters = {
        q: 'current filter',
        status: 'active',
        sortBy: 'createdAt',
        sortOrder: 'asc' as const,
      };
      await service.export(
        actor,
        { resource, filters },
        'export-intent',
        'export-request',
      );
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT permissions AS result FROM public.read_platform_access($1,$2)',
        [actor.userId, actor.sessionId],
      );
      expect(commands).toHaveLength(1);
      expect(commands[0]).toMatchObject({
        operation: 'submit',
        input: {
          kind: 'export',
          resource,
          input: { filters },
          credentialCiphertext: null,
        },
      });
    },
  );

  it('导入只提交加密临时凭据，密码与原生哈希都不进入任务 input', async () => {
    const { service, commands, privateResources, uploads } = setup();
    const result = await service.import(
      actor,
      importInput(),
      'import-secret',
      'import-request',
    );
    const submitted = commands.find((entry) => entry.operation === 'submit')!;
    expect(submitted.input.input).toEqual({
      inputResourceId,
      updateExisting: true,
    });
    const ciphertext = submitted.input.credentialCiphertext as string;
    const passwordHash = decryptPlatformTaskCredential(
      ciphertext,
      encryptionKey,
      result.id,
    );
    await expect(
      verifyPassword({ hash: passwordHash, password: initialPassword }),
    ).resolves.toBe(true);
    expect(JSON.stringify(submitted.input)).not.toContain(initialPassword);
    expect(JSON.stringify(submitted.input)).not.toContain(passwordHash);
    expect(JSON.stringify(result)).not.toContain(ciphertext);
    expect(privateResources.create).toHaveBeenCalledWith(
      actor,
      'task-input',
      expect.objectContaining({
        name: 'employees.xlsx',
        mimeType: PLATFORM_XLSX_MEDIA_TYPE,
        bytes: template.length,
      }),
      'import-request',
    );
    expect(uploads[0].bytes).toEqual(template);
  });

  it('同一幂等导入只上传一次；变更初始密码复用同一 key 被拒绝且不再上传', async () => {
    const { service, privateResources, commands, client } = setup();
    const first = await service.import(
      actor,
      importInput(),
      'same-import',
      'first-request',
    );
    const second = await service.import(
      actor,
      importInput(),
      'same-import',
      'retry-request',
    );
    expect(second.id).toBe(first.id);
    expect(privateResources.create).toHaveBeenCalledTimes(1);
    const submissions = commands.filter(
      (entry) => entry.operation === 'submit',
    );
    expect(submissions[1].input).toMatchObject({
      input: {},
      credentialCiphertext: null,
    });
    await expect(
      service.import(
        actor,
        {
          ...importInput(),
          initialPassword: 'different-import-batch-password',
        },
        'same-import',
        'changed-request',
      ),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_REUSED' } });
    expect(privateResources.create).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(3);
  });

  it('下载先通过任务固定函数复核授权，成功后才读取内部资源', async () => {
    const { service, events, commands } = setup();
    const id = randomUUID();
    const opened = await service.result(actor, id, 'download-request');
    expect(commands[0]).toMatchObject({ operation: 'download', id, input: {} });
    expect(events).toEqual([
      'command:download',
      `resource:open:${outputResourceId}`,
    ]);
    opened.read.body.destroy();
  });

  it('下载原动作已撤销时不打开内部资源', async () => {
    const { service, control, privateResources } = setup();
    control.downloadError = databaseFailure('FORBIDDEN');
    await expect(
      service.result(actor, randomUUID(), 'revoked-download'),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(privateResources.openInternal).not.toHaveBeenCalled();
  });

  it('平面导出取全量分页并沿用数据库返回的微秒窗口，不修改原始筛选', async () => {
    const { executeExport, client, pool, control, uploads } = setup();
    const pages: unknown[][] = [];
    const filters = {
      actorId: randomUUID(),
      eventCode: 'platform.user_created',
    };
    const window = {
      from: '2026-10-01T00:00:00.123456+00:00',
      to: '2026-10-17T00:00:00.654321+00:00',
    };
    control.page = (_sql, params) => {
      pages.push(params);
      return params[8] === 1
        ? {
            items: Array.from({ length: 100 }, (_, index) => ({
              id: String(index),
            })),
            total: 101,
            window,
          }
        : { items: [{ id: '100' }], total: 101, window };
    };
    const result = await executeExport('audit-events', filters, 'audit-export');
    expect(result.total).toBe(101);
    expect(uploads[0].purpose).toBe('task-output');
    expect(uploads[0].bytes.subarray(0, 2).toString()).toBe('PK');
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual([
      actor.userId,
      actor.sessionId,
      null,
      null,
      null,
      filters.actorId,
      filters.eventCode,
      null,
      1,
      100,
      'audit-export',
    ]);
    expect(pages[1]).toEqual([
      actor.userId,
      actor.sessionId,
      window.from,
      window.to,
      null,
      filters.actorId,
      filters.eventCode,
      null,
      2,
      100,
      'audit-export',
    ]);
    expect(filters).toEqual({
      actorId: filters.actorId,
      eventCode: 'platform.user_created',
    });
    expect(
      pool.query.mock.calls.filter(([sql]) =>
        sql.includes('read_platform_access'),
      ),
    ).toHaveLength(3);
  });

  it.each(['menus', 'departments'] as const)(
    '%s 导出按父节点递归且保持当前筛选，不丢子孙或重复祖先',
    async (resource) => {
      const { executeExport, control, client } = setup();
      const parent = randomUUID();
      const sibling = randomUUID();
      const child = randomUUID();
      const requests: Record<string, unknown>[] = [];
      const node = (
        id: string,
        parentId: string | null,
        hasChildren: boolean,
      ) => ({
        id,
        key: id,
        name: 'Sales',
        status: 'active',
        sort: 0,
        createdAt: '2026-10-17T00:00:00.000Z',
        updatedAt: '2026-10-17T00:00:00.000Z',
        parentId,
        hasChildren,
        ...(resource === 'menus'
          ? {
              kind: 'directory',
              routeKey: null,
              actionKey: null,
              url: null,
              icon: null,
              hidden: false,
            }
          : {}),
      });
      control.page = (_sql, params) => {
        const query = JSON.parse(String(params[5])) as Record<string, unknown>;
        requests.push(query);
        if (query.parentId === null)
          return {
            items: [node(parent, null, true), node(sibling, null, true)],
            ancestors: [],
          };
        if (query.parentId === parent)
          return {
            items: [node(child, parent, false), node(parent, null, true)],
            ancestors: [],
          };
        return { items: [], ancestors: [] };
      };
      const result = await executeExport(
        resource,
        { q: 'sales', status: 'active' },
        'tree-export',
      );
      expect(result.total).toBe(3);
      expect(
        vi
          .mocked(writePlatformExportWorkbook)
          .mock.lastCall![1].map((row) => row.id),
      ).toEqual([parent, sibling, child]);
      expect(client.release).toHaveBeenCalledTimes(1);
      expect(requests).toEqual(
        [null, parent, sibling].map((parentId) => ({
          q: 'sales',
          status: 'active',
          parentId,
        })),
      );
    },
  );

  it('导出翻页前失去当前动作会拒绝任务，保留锁释放且不产生文件', async () => {
    const { executeExport, control, commands, client, uploads } = setup();
    control.page = () => {
      control.permissions = [];
      return {
        items: Array.from({ length: 100 }, (_, id) => ({ userId: String(id) })),
        total: 101,
      };
    };
    await expect(
      executeExport('users', {}, 'revoked-export'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(commands.find((entry) => entry.operation === 'fail')?.input).toEqual(
      { status: 'rejected', errorCode: 'FORBIDDEN' },
    );
    expect(uploads).toEqual([]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it.each(['FORBIDDEN', 'AUTHORIZATION_UNAVAILABLE'] as const)(
    '领域导出错误 %s 仍按任务规则结算，不增加普通组织读取失败审计',
    async (code) => {
      const { executeExport, control, commands, pool, client, uploads } =
        setup();
      control.page = () => {
        throw databaseFailure(code);
      };
      await expect(
        executeExport('organizations', {}, 'failed-export'),
      ).rejects.toMatchObject(
        code === 'FORBIDDEN' ? { code } : { response: { code } },
      );
      expect(commands.some((entry) => entry.operation === 'fail')).toBe(
        code === 'FORBIDDEN',
      );
      expect(
        pool.query.mock.calls.some(([sql]) =>
          sql.includes('record_platform_organization_failure'),
        ),
      ).toBe(false);
      expect(uploads).toEqual([]);
      expect(client.release).toHaveBeenCalledTimes(1);
    },
  );

  it('导入执行将列错误转换为稳定结果码，真实报告 XLSX 不包含账号凭据', async () => {
    const { execute, control, commands, uploads, privateResources } = setup();
    const id = randomUUID();
    const reference: PlatformTaskReference = {
      scope: 'platform',
      taskId: id,
      actorId: actor.userId,
      sessionId: actor.sessionId,
      requestId: 'execute-import',
    };
    control.claim = {
      ...task(id, 'employees', 'employee-import'),
      status: 'running',
      sessionId: actor.sessionId,
      input: { inputResourceId, updateExisting: true },
      credentialCiphertext: encryptPlatformTaskCredential(
        'native-password-hash',
        encryptionKey,
        id,
      ),
    };
    vi.mocked(parsePlatformEmployeeImportWorkbook).mockResolvedValueOnce({
      rows: [
        {
          rowNumber: 2,
          status: 'invalid',
          errors: [
            { column: 'email', code: 'INVALID_EMAIL' },
            { column: 'postIds', code: 'INVALID_ID' },
          ],
        },
        {
          rowNumber: 3,
          status: 'valid',
          employee: {
            name: 'Employee',
            email: 'employee@test.example',
            departmentId: null,
            postIds: [],
            roleIds: [],
          },
        },
      ],
    });
    control.outcome = () => ({ outcome: 'failed', code: 'POST_NOT_FOUND' });
    await execute(reference);
    const complete = commands.find((entry) => entry.operation === 'complete')!;
    expect(complete.input.resultResourceId).toBe(outputResourceId);
    expect(complete.input.result).toEqual({
      total: 2,
      created: 0,
      updated: 0,
      granted: 0,
      skipped: 0,
      failed: 2,
      issues: [
        { rowNumber: 2, code: 'EMAIL_INVALID_EMAIL' },
        { rowNumber: 2, code: 'POSTIDS_INVALID_ID' },
        { rowNumber: 3, code: 'POST_NOT_FOUND' },
      ],
    } satisfies PlatformTaskResult);
    expect(JSON.stringify(complete.input)).not.toContain(
      'native-password-hash',
    );
    expect(privateResources.openInternal).toHaveBeenCalledWith(inputResourceId);
    expect(uploads[0].purpose).toBe('task-output');
    expect(uploads[0].bytes.subarray(0, 2).toString()).toBe('PK');
    expect(commands.some((entry) => entry.operation === 'fail')).toBe(false);
  });
});
