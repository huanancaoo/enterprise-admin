import { Readable } from 'node:stream';
import { operationalLogger } from '@workspace/observability';
import { createHash, createHmac } from 'node:crypto';
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import type { PoolClient } from 'pg';
import {
  PlatformTaskSchema,
  PlatformTaskPageSchema,
  ApiErrorCodeSchema,
  type CreatePlatformEmployeeImportTask,
  type CreatePlatformExportTask,
  type PlatformTaskQuery,
  type PlatformExportFilters,
  type PlatformExportResource,
  type PlatformTask,
  type PlatformTaskResult,
} from '@workspace/contracts';
import {
  createPlatformTaskRuntime,
  type PlatformTaskReference,
} from '@workspace/jobs/platform-runtime';
import { TaskPermanentError, type WorkerConfig } from '@workspace/jobs';
import {
  createPlatformEmployeeImportTemplate,
  parsePlatformEmployeeImportWorkbook,
  executePlatformEmployeeImport,
  writePlatformEmployeeImportReport,
  writePlatformExportWorkbook,
  PlatformWorkbookError,
  MAX_PLATFORM_IMPORT_BYTES,
  MAX_PLATFORM_EXPORT_ROWS,
  PLATFORM_XLSX_MEDIA_TYPE,
  type PlatformEmployeeImportOutcome,
  type PlatformEmployeeImportFailureCode,
} from '@workspace/jobs/platform-exchange';
import { AuthRuntime } from '../identity/auth-runtime';
import type { Identity } from '../identity/identity.service';
import { ApiException } from '../http/api-exception';
import { PlatformResources } from '../platform-resources/platform-resources';
import {
  encryptPlatformTaskCredential,
  decryptPlatformTaskCredential,
} from './platform-task-crypto';

export const PLATFORM_TASK_CONFIG = Symbol('platformTaskConfig');
export type PlatformTaskConfig = {
  worker: WorkerConfig;
  encryptionKey: Buffer;
};
type QueryExecutor = Pick<AuthRuntime['pool'], 'query'>;
type ClaimedTask = PlatformTask & {
  sessionId: string;
  input: {
    filters?: PlatformExportFilters;
    inputResourceId?: string;
    updateExisting?: boolean;
  };
  credentialCiphertext: string | null;
};
type ExportPage = {
  items: Record<string, unknown>[];
  total?: number;
  window?: { from: string; to: string };
};
const resources: Record<PlatformExportResource, string> = {
  employees: 'employee',
  roles: 'role',
  menus: 'menu',
  departments: 'department',
  posts: 'post',
  dictionaries: 'dictionary',
  'dictionary-items': 'dictionary-item',
  parameters: 'parameter',
  users: 'user',
  organizations: 'organization',
  'login-events': 'login',
  sessions: 'session',
  'audit-events': 'audit',
};
const rejectedCodes = new Set([
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'ACCOUNT_SUSPENDED',
  'ASSIGNMENT_INACTIVE',
]);
function fingerprint(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function taskIdentity(actor: Identity, key: string): string {
  const value = fingerprint([actor.userId, key]);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function stableCode(error: unknown): string {
  if (
    error instanceof PlatformWorkbookError ||
    error instanceof TaskPermanentError
  )
    return error.code;
  if (error instanceof ApiException)
    return (error.getResponse() as { code: string }).code;
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'P0001' &&
    /^[A-Z_]{1,100}$/.test(error.message)
  )
    return error.message;
  return 'EXECUTION_FAILED';
}

@Injectable()
export class PlatformTasks implements OnApplicationShutdown {
  private queueRuntime?: ReturnType<typeof createPlatformTaskRuntime>;
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly privateResources: PlatformResources,
    @Inject(PLATFORM_TASK_CONFIG) private readonly config: PlatformTaskConfig,
  ) {}
  start(): void {
    this.queueRuntime ??= createPlatformTaskRuntime(this.config.worker, {
      pending: async () => {
        const tasks: PlatformTaskReference[] = [];
        let after: string | null = null;
        for (;;) {
          const rows: PlatformTaskReference[] = await this.query<
            PlatformTaskReference[]
          >('SELECT public.platform_tasks_pending($1,100) AS result', [after]);
          if (!rows.length) return tasks;
          tasks.push(...rows);
          after = rows.at(-1)!.taskId;
        }
      },
      queued: async (task) => {
        await this.command(task, 'queued', task.taskId, {});
      },
      execute: (task) => this.execute(task),
      failed: async (task, code) => {
        await this.command(task, 'fail', task.taskId, {
          status: rejectedCodes.has(code) ? 'rejected' : 'failed',
          errorCode: code,
        });
      },
      fault: () =>
        operationalLogger.error({
          event: 'platform_task_runtime_failed',
          code: 'PLATFORM_TASK_RUNTIME_UNAVAILABLE',
        }),
    });
  }
  async onApplicationShutdown(): Promise<void> {
    await this.queueRuntime?.close();
  }
  async template(actor: Identity): Promise<Buffer> {
    await this.requireAction(actor, 'platform.authorization:manage');
    return createPlatformEmployeeImportTemplate();
  }
  async export(
    actor: Identity,
    input: CreatePlatformExportTask,
    key: string,
    requestId: string,
  ): Promise<PlatformTask> {
    this.validateKey(key);
    const id = taskIdentity(actor, key);
    await this.requireAction(actor, this.exportAction(input.resource));
    return PlatformTaskSchema.parse(
      await this.command(
        actor,
        'submit',
        id,
        {
          kind: 'export',
          resource: input.resource,
          idempotencyKey: key,
          intentFingerprint: fingerprint(input),
          input: { filters: input.filters },
          credentialCiphertext: null,
        },
        requestId,
      ),
    );
  }
  async import(
    actor: Identity,
    input: CreatePlatformEmployeeImportTask,
    key: string,
    requestId: string,
  ): Promise<PlatformTask> {
    this.validateKey(key);
    await this.requireAction(actor, 'platform.authorization:manage');
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (bytes.byteLength > MAX_PLATFORM_IMPORT_BYTES)
      throw new ApiException(400, 'VALIDATION_ERROR');
    // 在接受任务前验证工作簿结构，逐行校验结果仍由异步任务产出。
    await parsePlatformEmployeeImportWorkbook(bytes).catch(() => {
      throw new ApiException(400, 'VALIDATION_ERROR');
    });
    const id = taskIdentity(actor, key);
    const intent = fingerprint({
      fileName: input.fileName,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      updateExisting: input.updateExisting,
      credential: createHmac('sha256', this.config.encryptionKey)
        .update('platform-task-intent\0')
        .update(input.initialPassword)
        .digest('hex'),
    });
    const client = await this.runtime.pool.connect();
    try {
      // 同一幂等意图只上传一次私有输入；并发提交在此平台任务身份上串行。
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        id,
      ]);
      const existing = await this.command<PlatformTask | null>(
        actor,
        'find',
        id,
        { idempotencyKey: key },
        requestId,
        client,
      );
      if (existing)
        return PlatformTaskSchema.parse(
          await this.command(
            actor,
            'submit',
            id,
            {
              kind: 'employee-import',
              resource: 'employees',
              idempotencyKey: key,
              intentFingerprint: intent,
              input: {},
              credentialCiphertext: null,
            },
            requestId,
            client,
          ),
        );
      const resource = await this.privateResources.create(
        actor,
        'task-input',
        {
          name: input.fileName,
          mimeType: PLATFORM_XLSX_MEDIA_TYPE,
          bytes: bytes.byteLength,
          source: Readable.from([bytes]),
        },
        requestId,
      );
      const credential = encryptPlatformTaskCredential(
        await hashPassword(input.initialPassword),
        this.config.encryptionKey,
        id,
      );
      return PlatformTaskSchema.parse(
        await this.command(
          actor,
          'submit',
          id,
          {
            kind: 'employee-import',
            resource: 'employees',
            idempotencyKey: key,
            intentFingerprint: intent,
            input: {
              inputResourceId: resource.id,
              updateExisting: input.updateExisting,
            },
            credentialCiphertext: credential,
          },
          requestId,
          client,
        ),
      );
    } finally {
      await this.unlock(client, id, 0);
    }
  }
  async list(actor: Identity, input: PlatformTaskQuery, requestId: string) {
    return PlatformTaskPageSchema.parse(
      await this.command(actor, 'list', null, input, requestId),
    );
  }
  async get(actor: Identity, id: string, requestId: string) {
    return PlatformTaskSchema.parse(
      await this.command(actor, 'get', id, {}, requestId),
    );
  }
  async result(actor: Identity, id: string, requestId: string) {
    const value = await this.command<{ resultResourceId: string }>(
      actor,
      'download',
      id,
      {},
      requestId,
    );
    return this.privateResources.openInternal(value.resultResourceId);
  }
  private async unlock(
    client: PoolClient,
    id: string,
    salt: number,
  ): Promise<void> {
    let broken = false;
    try {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1,$2))', [
        id,
        salt,
      ]);
    } catch (error) {
      broken = true;
      throw error;
    } finally {
      client.release(broken);
    }
  }
  private exportAction(resource: PlatformExportResource): string {
    return `platform.${resource === 'dictionary-items' ? 'dictionary' : resources[resource]}:export`;
  }
  private validateKey(key: string): void {
    if (!key?.trim() || key.length > 200)
      throw new ApiException(400, 'VALIDATION_ERROR');
  }
  private async requireAction(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    action: string,
    executor: QueryExecutor = this.runtime.pool,
  ): Promise<void> {
    // 运行账号只读公开授权快照；任务提交、执行和下载仍由各领域固定函数重新授权。
    const permissions = await this.query<string[] | undefined>(
      'SELECT permissions AS result FROM public.read_platform_access($1,$2)',
      [actor.userId, actor.sessionId],
      executor,
    );
    if (!permissions?.includes(action))
      throw new ApiException(403, 'FORBIDDEN');
  }
  private command<T = unknown>(
    actor: Pick<Identity, 'userId' | 'sessionId'> | PlatformTaskReference,
    operation: string,
    id: string | null,
    input: unknown,
    requestId?: string,
    executor?: QueryExecutor,
  ): Promise<T> {
    const userId = 'actorId' in actor ? actor.actorId : actor.userId;
    return this.query(
      'SELECT public.platform_task_command($1,$2,$3,$4,$5::jsonb,$6) AS result',
      [
        userId,
        actor.sessionId,
        operation,
        id,
        JSON.stringify(input),
        requestId ?? ('requestId' in actor ? actor.requestId : ''),
      ],
      executor,
    );
  }
  private async query<T = unknown>(
    sql: string,
    params: unknown[],
    executor: QueryExecutor = this.runtime.pool,
  ): Promise<T> {
    try {
      return (await executor.query<{ result: T }>(sql, params)).rows[0]?.result;
    } catch (error) {
      const parsed = ApiErrorCodeSchema.safeParse(stableCode(error));
      if (parsed.success && parsed.data !== 'INTERNAL_ERROR') {
        const code = parsed.data;
        const status =
          code === 'NOT_FOUND'
            ? 404
            : ['VERSION_CONFLICT', 'IDEMPOTENCY_KEY_REUSED'].includes(code)
              ? 409
              : code === 'VALIDATION_ERROR'
                ? 400
                : ['AUDIT_UNAVAILABLE', 'AUTHORIZATION_UNAVAILABLE'].includes(
                      code,
                    )
                  ? 503
                  : 403;
        throw new ApiException(status, code);
      }
      throw error;
    }
  }
  private async execute(reference: PlatformTaskReference): Promise<void> {
    const client = await this.runtime.pool.connect();
    try {
      // BullMQ 锁续期丢失时可能重投；数据库锁与行收据共同约束重复业务执行。
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,1))', [
        reference.taskId,
      ]);
      const task = await this.command<ClaimedTask>(
        reference,
        'claim',
        reference.taskId,
        {},
        undefined,
        client,
      );
      if (['completed', 'failed', 'rejected'].includes(task.status)) return;
      const actor = {
        userId: reference.actorId,
        sessionId: reference.sessionId,
      } as Identity;
      let output: Buffer;
      let result: PlatformTaskResult;
      if (task.kind === 'employee-import') {
        if (!task.input.inputResourceId || !task.credentialCiphertext)
          throw new TaskPermanentError('INVALID_PLATFORM_TASK');
        const source = await this.privateResources.openInternal(
          task.input.inputResourceId,
        );
        const chunks: Buffer[] = [];
        for await (const chunk of source.read.body)
          chunks.push(Buffer.from(chunk as Uint8Array));
        const parsed = await parsePlatformEmployeeImportWorkbook(
          Buffer.concat(chunks),
        );
        const passwordHash = decryptPlatformTaskCredential(
          task.credentialCiphertext,
          this.config.encryptionKey,
          task.id,
        );
        const report = await executePlatformEmployeeImport(
          parsed,
          async (
            employee,
            rowNumber,
          ): Promise<PlatformEmployeeImportOutcome> => {
            const row = await this.query<{
              outcome: PlatformEmployeeImportOutcome['status'];
              code?: string;
            }>(
              'SELECT public.platform_task_employee_row($1,$2,$3,$4,$5::jsonb,$6) AS result',
              [
                reference.actorId,
                reference.sessionId,
                task.id,
                rowNumber,
                JSON.stringify({
                  employee,
                  passwordHash,
                  updateExisting: task.input.updateExisting,
                }),
                reference.requestId,
              ],
              client,
            );
            return row.outcome === 'failed'
              ? {
                  status: 'failed',
                  code: row.code as PlatformEmployeeImportFailureCode,
                }
              : { status: row.outcome };
          },
        );
        result = {
          total: report.rows.length,
          created: 0,
          updated: 0,
          granted: 0,
          skipped: 0,
          failed: 0,
          issues: [],
        };
        for (const row of report.rows) {
          if (row.status === 'invalid' || row.status === 'failed') {
            result.failed += 1;
            result.issues.push(
              ...row.codes.map((code) => ({
                rowNumber: row.rowNumber,
                code: code.replaceAll(':', '_').toUpperCase(),
              })),
            );
          } else result[row.status] += 1;
        }
        output = await writePlatformEmployeeImportReport(report);
      } else {
        const rows = await this.exportRows(
          actor,
          task.resource,
          task.input.filters ?? {},
          reference.requestId,
          client,
        );
        output = await writePlatformExportWorkbook(task.resource, rows);
        result = {
          total: rows.length,
          created: 0,
          updated: 0,
          granted: 0,
          skipped: 0,
          failed: 0,
          issues: [],
        };
      }
      const resource = await this.privateResources.create(
        actor,
        'task-output',
        {
          name: `${task.resource}-${task.id}.xlsx`,
          mimeType: PLATFORM_XLSX_MEDIA_TYPE,
          bytes: output.byteLength,
          source: Readable.from([output]),
        },
        reference.requestId,
      );
      await this.command(
        reference,
        'complete',
        task.id,
        { resultResourceId: resource.id, result },
        undefined,
        client,
      );
    } catch (error) {
      const code = stableCode(error);
      if (
        ![
          'EXECUTION_FAILED',
          'FILE_STORAGE_UNAVAILABLE',
          'AUDIT_UNAVAILABLE',
          'AUTHORIZATION_UNAVAILABLE',
          'INTERNAL_ERROR',
        ].includes(code)
      ) {
        await this.command(reference, 'fail', reference.taskId, {
          status: rejectedCodes.has(code) ? 'rejected' : 'failed',
          errorCode: code,
        });
        throw new TaskPermanentError(code);
      }
      throw error;
    } finally {
      await this.unlock(client, reference.taskId, 1);
    }
  }
  private async exportRows(
    actor: Identity,
    resource: PlatformExportResource,
    filters: PlatformExportFilters,
    requestId: string,
    client: PoolClient,
  ) {
    const rows: Record<string, unknown>[] = [];
    const tree = resource === 'menus' || resource === 'departments';
    const parents: Array<string | null> = [filters.parentId ?? null];
    const seen = new Set<string>();
    const queryFilters = { ...filters };
    for (let page = 1; ; page += 1) {
      await this.requireAction(actor, this.exportAction(resource));
      const parentId = tree ? parents.shift() : undefined;
      if (tree && parentId === undefined) break;
      const data = await this.exportPage(
        actor,
        resource,
        { ...queryFilters, ...(tree ? { parentId } : { page, pageSize: 100 }) },
        requestId,
        client,
      );
      for (const row of data.items) {
        if (tree) {
          const id = String(row.id);
          if (seen.has(id)) continue;
          seen.add(id);
          if (row.hasChildren) parents.push(id);
        }
        rows.push(row);
        if (rows.length > MAX_PLATFORM_EXPORT_ROWS)
          throw new TaskPermanentError('TOO_MANY_ROWS');
      }
      if (data.window) Object.assign(queryFilters, data.window);
      if (!tree && page * 100 >= (data.total ?? data.items.length)) break;
    }
    return rows;
  }
  private exportPage(
    actor: Identity,
    resource: PlatformExportResource,
    q: PlatformExportFilters & { page?: number; pageSize?: number },
    requestId: string,
    client: PoolClient,
  ): Promise<ExportPage> {
    const common = [actor.userId, actor.sessionId];
    const page = q.page ?? 1;
    const size = q.pageSize ?? 100;
    if (['employees', 'roles'].includes(resource))
      return this.query(
        'SELECT public.platform_system_identity($1,$2,$3,$4,$5,$6::jsonb,$7) AS result',
        [
          ...common,
          resources[resource],
          'export-page',
          null,
          JSON.stringify(q),
          requestId,
        ],
        client,
      );
    if (
      [
        'posts',
        'dictionaries',
        'dictionary-items',
        'parameters',
        'menus',
        'departments',
      ].includes(resource)
    )
      return this.query(
        'SELECT public.platform_system_catalog($1,$2,$3,$4,$5,$6::jsonb,$7) AS result',
        [
          ...common,
          resources[resource],
          'export-page',
          null,
          JSON.stringify(q),
          requestId,
        ],
        client,
      );
    if (resource === 'users')
      return this.query(
        'SELECT public.export_platform_users_page($1,$2,$3,$4,$5,$6) AS result',
        [...common, q.q ?? null, page, size, requestId],
        client,
      );
    if (resource === 'organizations')
      return this.query(
        'SELECT public.export_platform_organizations_page($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [
          ...common,
          q.q ?? null,
          q.status ?? null,
          page,
          size,
          q.sortBy ?? 'createdAt',
          q.sortOrder ?? 'desc',
          requestId,
        ],
        client,
      );
    if (resource === 'sessions')
      return this.query(
        'SELECT public.export_platform_sessions_page($1,$2,$3,$4,$5,$6,$7) AS result',
        [...common, q.q ?? null, q.userId ?? null, page, size, requestId],
        client,
      );
    if (resource === 'login-events')
      return this.query(
        'SELECT public.export_platform_login_logs_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        [
          ...common,
          q.q ?? null,
          q.userId ?? null,
          q.result ?? null,
          q.method ?? null,
          q.from ?? null,
          q.to ?? null,
          page,
          size,
          requestId,
        ],
        client,
      );
    return this.query(
      'SELECT public.export_platform_audit_events_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
      [
        ...common,
        q.from ?? null,
        q.to ?? null,
        q.organizationId ?? null,
        q.actorId ?? null,
        q.eventCode ?? null,
        q.result ?? null,
        page,
        size,
        requestId,
      ],
      client,
    );
  }
}
