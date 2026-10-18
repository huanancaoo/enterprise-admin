import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import {
  createTaskEnvelope,
  createTaskProducer,
  taskJobId,
  TaskPermanentError,
  type WorkerConfig,
} from '@workspace/jobs';
import { projectExchangeTasks } from '@workspace/jobs/project-exchange';
import {
  createTaskTenantRunner,
  TaskAuthorizationError,
} from '@workspace/database/task-tenant';
import { recordBusinessTaskAttempt } from '@workspace/database/business-task-control';
import { AuthorizationService } from '../authorization/authorization.service';
import { businessWorkerConfig } from './business-config';
import {
  BusinessTaskSchema,
  BusinessTaskErrorCodeSchema,
  TaskCenterPageSchema,
  type CreateProjectExport,
  type CreateProjectImport,
  type CapabilityPageQuery,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { businessTaskRepository } from '@workspace/database/repositories/business-tasks';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';

@Injectable()
export class BusinessTasks implements OnApplicationShutdown {
  private producer?: ReturnType<typeof createTaskProducer>;
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly authorization: AuthorizationService,
    @Inject(businessWorkerConfig) private readonly config: WorkerConfig,
  ) {}
  async onApplicationShutdown() {
    await this.producer?.close();
  }
  private response(
    row: Awaited<ReturnType<typeof businessTaskRepository.find>>,
  ) {
    if (!row) throw new ApiException(404, 'NOT_FOUND');
    return BusinessTaskSchema.parse({
      id: row.id,
      organizationId: row.organizationId,
      actorId: row.actorId,
      type: row.type,
      status: row.status,
      format: row.format,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      errorCode: row.errorCode,
      result: row.result,
      resultAvailable: row.resultContent !== null,
    });
  }
  async export(
    context: TenantContext,
    input: CreateProjectExport,
    idempotencyKey: string,
  ) {
    return this.submit(context, input, idempotencyKey, 'projects.export');
  }
  async import(
    context: TenantContext,
    input: CreateProjectImport,
    idempotencyKey: string,
  ) {
    return this.submit(context, input, idempotencyKey, 'projects.import');
  }
  private async submit(
    context: TenantContext,
    input: CreateProjectExport | CreateProjectImport,
    idempotencyKey: string,
    type: 'projects.export' | 'projects.import',
  ) {
    if (!idempotencyKey?.trim() || idempotencyKey.length > 200)
      throw new ApiException(400, 'VALIDATION_ERROR');
    const jobId = taskJobId(
      {
        organizationId: context.organizationId.toLowerCase(),
        actorId: context.userId.toLowerCase(),
      },
      type,
      idempotencyKey,
    );
    // 同一意图使用稳定资源身份，两个并发首次请求不会各自生成不同任务。
    const id = `${jobId.slice(0, 8)}-${jobId.slice(8, 12)}-4${jobId.slice(13, 16)}-a${jobId.slice(17, 20)}-${jobId.slice(20, 32)}`;
    const identity = {
      organizationId: context.organizationId,
      actorId: context.userId,
      resourceId: id,
      locale: context.locale,
      requestId: context.requestId,
    };
    const request = {
      type,
      identity,
      idempotencyKey,
      input,
    };
    const { intentFingerprint } = createTaskEnvelope(
      projectExchangeTasks,
      request,
    );
    const persisted = await createTaskTenantRunner(this.runtime.pool)(
      identity,
      { project: [type === 'projects.export' ? 'export' : 'create'] },
      async (tx) => {
        const task = await businessTaskRepository.create(tx, {
          id,
          organizationId: context.organizationId,
          actorId: context.userId,
          type,
          format: input.format,
          locale: context.locale,
          idempotencyKey,
          jobId,
          intentFingerprint,
          requestId: context.requestId,
          input,
        });
        if (task.intentFingerprint !== intentFingerprint)
          throw new ApiException(409, 'IDEMPOTENCY_KEY_REUSED');
        return task;
      },
    ).catch((error: unknown) => {
      // HTTP 初检后资格仍可能改变；事务拒绝属于当前授权失败，不能报为执行故障。
      if (!(error instanceof TaskAuthorizationError)) throw error;
      if (error.code === 'ACCOUNT_SUSPENDED')
        throw new ApiException(403, 'ACCOUNT_SUSPENDED');
      if (error.code === 'AUTHORIZATION_UNAVAILABLE')
        throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
      throw new ApiException(
        403,
        error.code === 'ORGANIZATION_SUSPENDED' ? error.code : 'FORBIDDEN',
      );
    });
    if (['completed', 'failed', 'rejected'].includes(persisted.status))
      return this.response(persisted);
    // 导出 OpenAPI 只构造应用，不启动网络运行时；生产者由真实业务请求取得。
    this.producer ??= createTaskProducer({
      config: this.config,
      registry: projectExchangeTasks,
      runInTenant: createTaskTenantRunner(this.runtime.pool),
    });
    const submission = await this.producer
      .submit(request)
      .catch(async (error: unknown) => {
        if (!(error instanceof TaskPermanentError)) throw error;
        const parsed = BusinessTaskErrorCodeSchema.safeParse(error.code);
        // 意图已经提交，生产者永久拒绝也要立即持久结算，恢复权限不能重新派发旧意图。
        await recordBusinessTaskAttempt(
          this.runtime.pool,
          { ...identity, intentFingerprint },
          'rejected',
          parsed.success ? parsed.data : 'EXECUTION_FAILED',
        );
        return { status: 'rejected' } as const;
      });
    if (
      submission.status === 'enqueued' ||
      submission.status === 'already_exists'
    ) {
      await createTenantRunner(this.runtime.pool)(
        context,
        (tx) => businessTaskRepository.markQueued(tx, id),
        'write',
      );
    }
    return this.get(context, id);
  }
  async get(context: TenantContext, id: string) {
    return createTenantRunner(this.runtime.pool)(context, async (tx) =>
      this.response(await businessTaskRepository.findVisible(tx, id)),
    );
  }
  async getForRequest(context: TenantContext, id: string, headers: Headers) {
    const connection = await this.runtime.pool.connect();
    try {
      return await createTenantRunner(connection)(context, async (tx) => {
        const row = await businessTaskRepository.findVisible(tx, id);
        if (!row) throw new ApiException(404, 'NOT_FOUND');
        // Cookie 用户保留本人任务历史；调用凭据必须按任务来源动作复核 scope 与当前角色。
        if (headers.has('x-api-key'))
          await this.authorization.requirePermissionInTransaction(
            connection,
            headers,
            context.organizationId,
            { project: [row.type === 'projects.export' ? 'export' : 'create'] },
          );
        return this.response(row);
      });
    } finally {
      connection.release();
    }
  }
  async center(context: TenantContext, query: CapabilityPageQuery) {
    return createTenantRunner(this.runtime.pool)(context, async (tx) =>
      TaskCenterPageSchema.parse(
        await businessTaskRepository.center(tx, query.page, query.pageSize),
      ),
    );
  }
  async list(context: TenantContext, query: CapabilityPageQuery) {
    return createTenantRunner(this.runtime.pool)(context, async (tx) => {
      const page = await businessTaskRepository.list(
        tx,
        query.page,
        query.pageSize,
      );
      return { ...page, items: page.items.map((row) => this.response(row)) };
    });
  }
  async result(context: TenantContext, id: string, headers: Headers) {
    const connection = await this.runtime.pool.connect();
    try {
      return await createTenantRunner(connection)(context, async (tx) => {
        const row = await businessTaskRepository.findVisible(tx, id);
        if (!row) throw new ApiException(404, 'NOT_FOUND');
        // 产物可含组织数据，Cookie 与凭据下载都必须在读事务内复核原动作。
        await this.authorization.requirePermissionInTransaction(
          connection,
          headers,
          context.organizationId,
          { project: [row.type === 'projects.export' ? 'export' : 'create'] },
        );
        if (!row.resultContent) throw new ApiException(404, 'NOT_FOUND');
        return {
          bytes: Buffer.from(row.resultContent, 'base64'),
          format: row.type === 'projects.import' ? 'json' : row.format,
        };
      });
    } finally {
      connection.release();
    }
  }
}
