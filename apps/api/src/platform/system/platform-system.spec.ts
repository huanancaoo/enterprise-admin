import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CreatePlatformEmployeeSchema,
  PlatformEmployeeSchema,
  PlatformSystemTreeQuerySchema,
  UpdatePlatformEmployeeSchema,
  type PlatformEmployee,
} from '@workspace/contracts';
import { verifyPassword } from 'better-auth/crypto';
import type { Server } from 'node:http';
import type { PoolClient } from 'pg';
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
import { configureApp } from '../../http/configure-app';
import { AuthRuntime } from '../../identity/auth-runtime';
import { IdentityService } from '../../identity/identity.service';
import { createOpenApiDocument } from '../../openapi/create-document';
import {
  PlatformAccessService,
  type PlatformPrincipal,
} from '../platform-access.service';
import { PlatformGuard } from '../platform.guard';
import { PlatformSystem } from './platform-system';
import { PlatformEmployeesController } from './employees.controller';
import { PlatformDictionariesController } from './dictionaries.controller';
import { PlatformParametersController } from './parameters.controller';
import { PlatformRolesController } from './roles.controller';
import { PlatformDepartmentsController } from './departments.controller';
import { PlatformPostsController } from './posts.controller';

const actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
} as PlatformPrincipal;
const entityId = '00000000-0000-4000-8000-000000000003';
const childId = '00000000-0000-4000-8000-000000000004';
const roleId = '00000000-0000-4000-8000-000000000005';

const employee: PlatformEmployee = {
  userId: entityId,
  name: 'Operator',
  maskedEmail: 'o***@example.test',
  status: 'active',
  departmentId: null,
  postIds: [],
  roleIds: [],
  department: null,
  posts: [],
  roles: [],
  version: 1,
  lockedUntil: null,
  failedAttempts: 0,
  createdAt: '2026-10-17T00:00:00.000Z',
};
const linkedEmployee: PlatformEmployee = {
  ...employee,
  departmentId: childId,
  postIds: [entityId],
  roleIds: [roleId],
  department: { id: childId, name: 'Engineering' },
  posts: [{ id: entityId, name: 'Support' }],
  roles: [{ id: roleId, key: 'operator', name: 'Operator', builtIn: false }],
};
const dictionaryItem = {
  id: childId,
  dictionaryId: entityId,
  value: 'a',
  label: 'A',
  status: 'active',
  sort: 0,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};
type Query = (
  statement: string,
  values: unknown[],
) => Promise<{ rows: { result: unknown }[] }>;
function createService() {
  const query = vi
    .fn<Query>()
    .mockResolvedValue({ rows: [{ result: employee }] });
  const service = new PlatformSystem({
    pool: { query },
  } as unknown as AuthRuntime);
  return { query, service };
}

describe('PlatformSystem database boundary', () => {
  it('keeps employee exports on the task connection and rejects private projection drift', async () => {
    const { query, service } = createService();
    const page = { items: [employee], page: 1, pageSize: 100, total: 1 };
    const taskQuery = vi
      .fn<Query>()
      .mockResolvedValueOnce({ rows: [{ result: page }] })
      .mockResolvedValueOnce({
        rows: [
          {
            result: {
              ...page,
              items: [{ ...employee, passwordHash: 'must-not-be-exported' }],
            },
          },
        ],
      });
    const client = { query: taskQuery } as unknown as PoolClient;
    await expect(
      service.employees.exportPage(
        actor,
        { page: 1, pageSize: 100 },
        'export-employees',
        client,
      ),
    ).resolves.toEqual(page);
    await expect(
      service.employees.exportPage(
        actor,
        { page: 1, pageSize: 100 },
        'export-employees',
        client,
      ),
    ).rejects.toThrow();
    expect(taskQuery).toHaveBeenCalledTimes(2);
    expect(taskQuery.mock.calls[0][1].slice(2, 4)).toEqual([
      'employee',
      'export-page',
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('passes only the Better Auth password hash to the fixed employee function', async () => {
    const { query, service } = createService();
    const password = 'A-platform-password-42';
    await service.employees.create(
      actor,
      {
        mode: 'create',
        name: 'Operator',
        email: 'operator@example.test',
        password,
        roleIds: [entityId],
      },
      'request-create',
    );
    const [statement, values] = query.mock.calls[0];
    expect(statement).toBe(
      'SELECT public.platform_system_identity($1,$2,$3,$4,$5,$6::jsonb,$7) AS result',
    );
    expect(values.slice(0, 5)).toEqual([
      actor.userId,
      actor.sessionId,
      'employee',
      'create',
      null,
    ]);
    const input = JSON.parse(values[5] as string) as Record<string, string>;
    expect(input).not.toHaveProperty('password');
    expect(JSON.stringify(values)).not.toContain(password);
    expect(await verifyPassword({ password, hash: input.passwordHash })).toBe(
      true,
    );
  });

  it('does not create a credential when granting employment to an existing account', async () => {
    const { query, service } = createService();
    await service.employees.create(
      actor,
      { mode: 'existing', userId: entityId, roleIds: [] },
      'request-existing',
    );
    expect(JSON.parse(query.mock.calls[0][1][5] as string) as unknown).toEqual({
      mode: 'existing',
      userId: entityId,
      roleIds: [],
    });
  });

  it('revalidates through the database on each call and exposes the next-request denial', async () => {
    const { query, service } = createService();
    query.mockResolvedValueOnce({
      rows: [{ result: { items: [], page: 1, pageSize: 20, total: 0 } }],
    });
    query.mockRejectedValueOnce(
      Object.assign(new Error('FORBIDDEN'), { code: 'P0001' }),
    );
    const queryInput = {
      page: 1,
      pageSize: 20,
      sortBy: 'sort',
      sortOrder: 'asc',
    } as const;
    await service.posts.list(actor, queryInput, 'first');
    await expect(
      service.posts.list(actor, queryInput, 'second'),
    ).rejects.toMatchObject({ response: { code: 'FORBIDDEN' }, status: 403 });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1].slice(0, 2)).toEqual([
      actor.userId,
      actor.sessionId,
    ]);
  });

  it.each([
    ['UNAUTHENTICATED', 401],
    ['FORBIDDEN', 403],
    ['ACCOUNT_SUSPENDED', 403],
    ['NOT_FOUND', 404],
    ['VALIDATION_ERROR', 400],
    ['TREE_CYCLE', 409],
    ['PARENT_DISABLED', 409],
    ['RESOURCE_IN_USE', 409],
    ['KEY_ALREADY_EXISTS', 409],
    ['LAST_PLATFORM_SUPERADMIN', 409],
    ['BUILT_IN_ROLE_IMMUTABLE', 409],
    ['EMAIL_ALREADY_EXISTS', 409],
    ['VERSION_CONFLICT', 409],
    ['AUDIT_UNAVAILABLE', 503],
    ['AUTHORIZATION_UNAVAILABLE', 503],
  ])('maps database %s to HTTP %s', async (code, status) => {
    const { query, service } = createService();
    query.mockRejectedValueOnce(
      Object.assign(new Error(code), { code: 'P0001' }),
    );
    await expect(
      service.roles.remove(actor, entityId, 'request'),
    ).rejects.toMatchObject({ response: { code }, status });
  });

  it('preserves unexpected database failures', async () => {
    const { query, service } = createService();
    const failure = new Error('connection failed');
    query.mockRejectedValueOnce(failure);
    await expect(
      service.parameters.get(actor, entityId, 'request'),
    ).rejects.toBe(failure);
  });
});

describe('PlatformSystem strict HTTP contracts', () => {
  let app: INestApplication;
  const query = vi.fn<Query>();
  const origin = 'http://localhost:3201';

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        PlatformEmployeesController,
        PlatformDictionariesController,
        PlatformParametersController,
        PlatformRolesController,
        PlatformDepartmentsController,
        PlatformPostsController,
      ],
      providers: [
        PlatformSystem,
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
          useValue: {
            requireAccess: vi.fn().mockResolvedValue(actor),
            recordDenial: vi.fn(),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApp(app, () => Promise.resolve('zh-CN'));
    await app.init();
  });
  afterAll(async () => app?.close());
  beforeEach(() =>
    query.mockReset().mockResolvedValue({
      rows: [{ result: { items: [], page: 1, pageSize: 20, total: 0 } }],
    }),
  );

  it('resolves the candidate path before the employee detail route', async () => {
    const result = await request(app.getHttpServer() as Server).get(
      '/api/v1/platform/employees/candidates?q=operator',
    );
    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(query.mock.calls[0][1].slice(2, 5)).toEqual([
      'employee',
      'candidates',
      null,
    ]);
    expect(JSON.parse(query.mock.calls[0][1][5] as string) as unknown).toEqual({
      q: 'operator',
      page: 1,
      pageSize: 20,
    });
  });

  it.each([
    {
      kind: 'department',
      item: {
        id: childId,
        key: 'engineering',
        name: 'Engineering',
        status: 'active',
        parentId: null,
        hasChildren: false,
      },
    },
    {
      kind: 'post',
      item: { id: entityId, key: 'support', name: 'Support', status: 'active' },
    },
    {
      kind: 'role',
      item: { id: roleId, key: 'operator', name: 'Operator', status: 'active' },
    },
  ])(
    'resolves employee $kind options as a static paginated route',
    async ({ kind, item }) => {
      const page = { items: [item], page: 2, pageSize: 10, total: 11 };
      query.mockResolvedValueOnce({ rows: [{ result: page }] });
      const result = await request(app.getHttpServer() as Server).get(
        `/api/v1/platform/employees/${kind}-options?q=team&page=2&pageSize=10`,
      );
      expect(result.status).toBe(200);
      expect(result.body).toEqual(page);
      expect(result.headers['cache-control']).toBe('private, no-store');
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toBe(
        'SELECT public.list_platform_employee_options($1,$2,$3,$4::jsonb,$5) AS result',
      );
      expect(query.mock.calls[0][1].slice(0, 3)).toEqual([
        actor.userId,
        actor.sessionId,
        kind,
      ]);
      expect(
        JSON.parse(query.mock.calls[0][1][3] as string) as unknown,
      ).toEqual({ q: 'team', page: 2, pageSize: 10 });
    },
  );

  it.each([
    { kind: 'department', filter: 'permissions=platform.department:read' },
    { kind: 'post', filter: `departmentId=${entityId}` },
    { kind: 'department', filter: 'pageSize=101' },
    { kind: 'post', filter: 'page=0' },
    { kind: 'role', filter: 'ids=not-a-uuid' },
    { kind: 'role', filter: 'status=suspended' },
    {
      kind: 'department',
      filter: `ids=${Array.from({ length: 101 }, () => entityId).join(',')}`,
    },
  ])(
    'rejects undeclared or out-of-range $kind option query $filter',
    async ({ kind, filter }) => {
      const result = await request(app.getHttpServer() as Server).get(
        `/api/v1/platform/employees/${kind}-options?${filter}`,
      );
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('keeps selected option IDs as a string and passes the explicit status filter', async () => {
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/employees/department-options?ids=${entityId},${childId}&status=disabled`,
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(query.mock.calls[0][1][3] as string) as unknown).toEqual({
      page: 1,
      pageSize: 20,
      ids: `${entityId},${childId}`,
      status: 'disabled',
    });
  });

  it('maps an option authorization denial from the fixed database function', async () => {
    query.mockRejectedValueOnce(
      Object.assign(new Error('FORBIDDEN'), { code: 'P0001' }),
    );
    const result = await request(app.getHttpServer() as Server).get(
      '/api/v1/platform/employees/post-options',
    );
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(JSON.parse(query.mock.calls[0][1][3] as string) as unknown).toEqual({
      page: 1,
      pageSize: 20,
    });
  });

  it('returns employee association summaries without requesting complete directories', async () => {
    query.mockResolvedValueOnce({ rows: [{ result: linkedEmployee }] });
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/employees/${entityId}`,
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual(linkedEmployee);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1].slice(2, 5)).toEqual([
      'employee',
      'get',
      entityId,
    ]);
  });

  it('rejects role permissions leaked through the employee association summary', async () => {
    const privateProjection = {
      ...linkedEmployee,
      roles: [
        {
          ...linkedEmployee.roles[0],
          permissions: ['platform.authorization:manage'],
        },
      ],
    };
    expect(PlatformEmployeeSchema.safeParse(privateProjection).success).toBe(
      false,
    );
    query.mockResolvedValueOnce({ rows: [{ result: privateProjection }] });
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/employees/${entityId}`,
    );
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(result.text).not.toContain('permissions');
    expect(result.text).not.toContain('platform.authorization:manage');
  });

  it('rejects complete catalog fields in the restricted employee option response', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            items: [
              {
                id: entityId,
                key: 'support',
                name: 'Support',
                status: 'active',
                permissions: ['platform.post:update'],
              },
            ],
            page: 1,
            pageSize: 20,
            total: 1,
          },
        },
      ],
    });
    const result = await request(app.getHttpServer() as Server).get(
      '/api/v1/platform/employees/post-options',
    );
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(result.text).not.toContain('Support');
  });

  it('rejects unknown query fields before executing a database function', async () => {
    const result = await request(app.getHttpServer() as Server).get(
      '/api/v1/platform/employees?permissions=platform.authorization:manage',
    );
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects role changes through the employee profile endpoint', async () => {
    const result = await request(app.getHttpServer() as Server)
      .patch(`/api/v1/platform/employees/${entityId}`)
      .set('Origin', origin)
      .send({
        name: 'Operator',
        departmentId: null,
        postIds: [],
        expectedVersion: 1,
        roleIds: [childId],
      });
    expect(result.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects credentials on an existing-account grant', () => {
    expect(
      CreatePlatformEmployeeSchema.safeParse({
        mode: 'existing',
        userId: entityId,
        password: 'Some-password-42',
      }).success,
    ).toBe(false);
    expect(
      UpdatePlatformEmployeeSchema.safeParse({
        name: 'Operator',
        departmentId: null,
        postIds: [],
        expectedVersion: 1,
        email: 'other@example.test',
      }).success,
    ).toBe(false);
    expect(PlatformSystemTreeQuerySchema.safeParse({ page: '2' }).success).toBe(
      false,
    );
  });

  it('preserves dictionary ownership for nested single-item reads', async () => {
    query.mockResolvedValueOnce({ rows: [{ result: dictionaryItem }] });
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/dictionaries/${entityId}/items/${childId}`,
    );
    expect(result.status).toBe(200);
    expect(query.mock.calls[0][1].slice(2, 5)).toEqual([
      'dictionary-item',
      'get',
      childId,
    ]);
    expect(JSON.parse(query.mock.calls[0][1][5] as string) as unknown).toEqual({
      dictionaryId: entityId,
    });
  });

  it.each([
    { method: 'get', operation: 'get', suffix: '', body: undefined },
    {
      method: 'patch',
      operation: 'update',
      suffix: '',
      body: {
        key: 'employee_status',
        name: 'Employee status',
        status: 'active',
        sort: 0,
        remark: null,
      },
    },
    { method: 'delete', operation: 'delete', suffix: '', body: undefined },
    {
      method: 'patch',
      operation: 'set-status',
      suffix: '/status',
      body: { status: 'disabled' },
    },
  ] as const)(
    'passes a dictionary type $operation id separately from its declared input',
    async ({ method, operation, suffix, body }) => {
      const dictionary = {
        id: entityId,
        key: 'employee_status',
        name: 'Employee status',
        status: 'active',
        sort: 0,
        remark: null,
        createdAt: '2026-10-17T00:00:00.000Z',
        updatedAt: '2026-10-17T00:00:00.000Z',
      };
      query.mockResolvedValueOnce({
        rows: [
          {
            result:
              operation === 'delete'
                ? { id: entityId, deleted: true }
                : dictionary,
          },
        ],
      });
      const call = request(app.getHttpServer() as Server)
        [method](`/api/v1/platform/dictionaries/${entityId}${suffix}`)
        .set('Origin', origin);
      if (body) call.send(body);
      const result = await call;
      expect(result.status).toBe(200);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][1].slice(2, 5)).toEqual([
        'dictionary',
        operation,
        entityId,
      ]);
      expect(JSON.parse(query.mock.calls[0][1][5] as string)).toEqual(
        body ?? {},
      );
    },
  );

  it('uses a null entity id for dictionary item creation and injects the parent', async () => {
    query.mockResolvedValueOnce({ rows: [{ result: dictionaryItem }] });
    const result = await request(app.getHttpServer() as Server)
      .post(`/api/v1/platform/dictionaries/${entityId}/items`)
      .set('Origin', origin)
      .send({ value: 'a', label: 'A', status: 'active', sort: 0 });
    expect(result.status).toBe(201);
    expect(query.mock.calls[0][1].slice(2, 5)).toEqual([
      'dictionary-item',
      'create',
      null,
    ]);
    expect(JSON.parse(query.mock.calls[0][1][5] as string) as unknown).toEqual({
      dictionaryId: entityId,
      value: 'a',
      label: 'A',
      status: 'active',
      sort: 0,
    });
  });

  it('parses assigned=false as a boolean for role employee filtering', async () => {
    const result = await request(app.getHttpServer() as Server).get(
      `/api/v1/platform/roles/${entityId}/employees?assigned=false`,
    );
    expect(result.status).toBe(200);
    expect(
      JSON.parse(query.mock.calls[0][1][5] as string) as unknown,
    ).toMatchObject({
      assigned: false,
      page: 1,
      pageSize: 20,
    });
  });

  it('rejects response drift without exposing database fields', async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            items: [],
            page: 1,
            pageSize: 20,
            total: 0,
            passwordHash: 'private-value',
          },
        },
      ],
    });
    const result = await request(app.getHttpServer() as Server).get(
      '/api/v1/platform/employees/candidates',
    );
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(result.text).not.toContain('passwordHash');
    expect(result.text).not.toContain('private-value');
  });

  it('exports static operations and strict request schemas for formal SDK generation', () => {
    const document = createOpenApiDocument(app);
    const paths = document.paths;
    expect(
      paths['/api/v1/platform/employees/candidates']?.get?.operationId,
    ).toBe('listPlatformEmployeeCandidates');
    expect(
      paths['/api/v1/platform/employees/department-options']?.get?.operationId,
    ).toBe('listPlatformEmployeeDepartmentOptions');
    expect(
      paths['/api/v1/platform/employees/post-options']?.get?.operationId,
    ).toBe('listPlatformEmployeePostOptions');
    expect(
      paths['/api/v1/platform/employees/role-options']?.get?.operationId,
    ).toBe('listPlatformEmployeeRoleOptions');
    expect(
      document.components?.schemas?.PlatformEmployeeRoleSummary,
    ).toMatchObject({
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        key: { type: 'string' },
        name: { type: 'string' },
        builtIn: { type: 'boolean' },
      },
    });
    expect(
      document.components?.schemas?.PlatformEmployeeRoleSummary,
    ).not.toHaveProperty('properties.permissions');
    expect(paths['/api/v1/platform/menus']).toBeUndefined();
    expect(paths['/api/v1/platform/menus/registry']).toBeUndefined();
    expect(paths['/api/v1/platform/navigation']).toBeUndefined();
    expect(
      paths['/api/v1/platform/dictionaries/{dictionaryId}/items/{itemId}']
        ?.patch?.operationId,
    ).toBe('updatePlatformDictionaryItem');
    expect(document.components?.schemas?.UpdatePlatformEmployee).toMatchObject({
      additionalProperties: false,
    });
    expect(
      document.components?.schemas?.PlatformNavigationItem,
    ).toBeUndefined();
    const methods = ['get', 'post', 'patch', 'delete'] as const;
    const operations = Object.values(paths).flatMap((path) =>
      methods.map((method) => path?.[method]?.operationId).filter(Boolean),
    );
    expect(new Set(operations).size).toBe(operations.length);
  });
});
