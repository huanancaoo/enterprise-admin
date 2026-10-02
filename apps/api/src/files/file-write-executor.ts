import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FileOperationResponse } from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import {
  fileRepository,
  type FileOperation,
} from '@workspace/database/repositories/files';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import { ApiException } from '../http/api-exception';
import { apiFailureCode } from '../http/api-error.filter';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { FilesRuntime } from './files-runtime';
import { FileLease } from './file-lease';
import { FileMaintenance } from './file-maintenance';
import { fileOperationResponse } from './file-responses';
import { rethrowFileError } from './file-http-errors';
import { StorageError, type FileStorage } from './storage/storage';

type FileWriteRequest = {
  id: string;
  action: FileOperation['action'];
  request: Record<string, unknown>;
  input: Record<string, unknown>;
  permissions: PermissionRequest;
};

export type FileWriteScope = {
  operation: FileOperation;
  storage: FileStorage;
  signal: AbortSignal;
  leaseId: string;
  // 回调使用传入的 tx；再次调用 scope 写入口会等待自身持有的串行事务。
  write<T>(work: (tx: TenantTx, now: Date) => Promise<T>): Promise<T>;
  publish(
    work: (tx: TenantTx, now: Date) => Promise<unknown>,
  ): Promise<FileOperationResponse>;
  complete(
    work?: (tx: TenantTx, now: Date) => Promise<unknown>,
  ): Promise<FileOperationResponse>;
};

@Injectable()
export class FileWriteExecutor implements OnModuleDestroy {
  private readonly logger = new Logger(FileWriteExecutor.name);
  private readonly shutdown = new AbortController();
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    private readonly identity: AuthRuntime,
    private readonly actors: IdentityService,
    private readonly authorization: AuthorizationService,
    private readonly runtime: FilesRuntime,
    private readonly maintenance: FileMaintenance,
  ) {}

  async onModuleDestroy(): Promise<void> {
    this.shutdown.abort(new StorageError('STORAGE_UNAVAILABLE'));
    await Promise.allSettled(this.running);
  }

  async execute(
    context: TenantContext,
    headers: Headers,
    request: FileWriteRequest,
    work: (scope: FileWriteScope) => Promise<FileOperationResponse>,
    options: {
      signal?: AbortSignal;
      onReuse?: (
        operation: FileOperation,
        signal: AbortSignal,
      ) => Promise<void>;
    } = {},
  ): Promise<FileOperationResponse> {
    const task = this.perform(context, headers, request, work, options);
    this.running.add(task);
    try {
      return await task;
    } finally {
      this.running.delete(task);
    }
  }

  private async currentActor(
    tx: TenantTx,
    client: PoolClient,
    headers: Headers,
    permissions: PermissionRequest,
  ): Promise<Date> {
    const actor = await this.actors.requireIdentity(headers);
    // 平台策略写也等待 usage；获取身份必须在持锁前，最终授权则复用持锁连接。
    await fileRepository.lockOrganization(tx);
    await fileRepository.requireCurrentActor(tx, actor.sessionId);
    await this.authorization.requirePermissionInTransaction(
      client,
      headers,
      tx.context.organizationId,
      permissions,
    );
    // 会话/成员锁保护撤销时序；原生授权等待结束后再次检查实际到期时间。
    return fileRepository.requireCurrentActor(tx, actor.sessionId);
  }

  private async perform(
    context: TenantContext,
    headers: Headers,
    request: FileWriteRequest,
    work: (scope: FileWriteScope) => Promise<FileOperationResponse>,
    options: {
      signal?: AbortSignal;
      onReuse?: (
        operation: FileOperation,
        signal: AbortSignal,
      ) => Promise<void>;
    },
  ): Promise<FileOperationResponse> {
    const storage = this.runtime.requireStorage();
    const leaseId = randomUUID();
    const signal = options.signal
      ? AbortSignal.any([this.shutdown.signal, options.signal])
      : this.shutdown.signal;
    let claimed = false;
    let published: FileOperationResponse | undefined;
    let completed: FileOperationResponse | undefined;
    let operationSignal: AbortSignal | undefined;
    try {
      return await this.runtime.requirePhysicalScope().run(
        { kind: 'organization', id: context.organizationId },
        async (scopeSignal, client) => {
          // 续租与业务写共享持有物理锁的连接，不能重叠开启事务。
          let pending: Promise<unknown> = Promise.resolve();
          const transaction = <T>(callback: (tx: TenantTx) => Promise<T>) => {
            const result = pending.then(() =>
              createTenantRunner(client)(context, callback).catch(
                (error: unknown) => rethrowTenantWriteError(error, context),
              ),
            );
            pending = result.then(
              () => {},
              () => {},
            );
            return result;
          };
          const currentActor = (tx: TenantTx) =>
            this.currentActor(tx, client, headers, request.permissions);
          const started = performance.now();
          const admission = await transaction(async (tx) => {
            const now = await currentActor(tx);
            const begun = await fileRepository.beginOperation(tx, {
              id: request.id,
              action: request.action,
              input: request.input,
              requestHash: createHash('sha256')
                .update(JSON.stringify(request.request))
                .digest('hex'),
              expiresAt: new Date(now.getTime() + 86_400_000),
            });
            if (begun.reused) return { ...begun, now };
            const operation = await fileRepository.claimOperation(
              tx,
              request.id,
              leaseId,
              now,
            );
            if (!operation)
              throw new ApiException(409, 'FILE_OPERATION_IN_PROGRESS');
            // 提交确认丢失时仍以当前 token 移交；固定函数只接受持久化的认领。
            claimed = true;
            return { operation, reused: false, now };
          });
          if (admission.reused) {
            await options.onReuse?.(admission.operation, scopeSignal);
            return fileOperationResponse(admission.operation);
          }
          const lease = new FileLease(
            admission.operation.leaseExpiresAt!.getTime() -
              admission.now.getTime() -
              (performance.now() - started),
            scopeSignal,
            async () => {
              const renewStarted = performance.now();
              const renewed = await transaction(async (tx) => {
                const now = await currentActor(tx);
                const operation = await fileRepository.renewOperation(
                  tx,
                  request.id,
                  leaseId,
                  now,
                );
                return operation.leaseExpiresAt!.getTime() - now.getTime();
              });
              return renewed - (performance.now() - renewStarted);
            },
          );
          operationSignal = lease.signal;
          const write = <T>(
            callback: (tx: TenantTx, now: Date) => Promise<T>,
          ) =>
            transaction(async (tx) => {
              lease.signal.throwIfAborted();
              const now = await currentActor(tx);
              await fileRepository.renewOperation(tx, request.id, leaseId, now);
              lease.signal.throwIfAborted();
              return callback(tx, now);
            });
          try {
            return await work({
              operation: admission.operation,
              storage,
              signal: lease.signal,
              leaseId,
              write,
              publish: async (callback) => {
                const result = await write(async (tx, now) => {
                  await callback(tx, now);
                  const operation = await fileRepository.findOperation(
                    tx,
                    request.id,
                  );
                  return fileOperationResponse(operation);
                });
                published = result;
                return result;
              },
              complete: async (callback) => {
                // 最后一次提交不再续租；避免完成事实提交后定时器又尝试续租。
                await lease.stop();
                const result = await write(async (tx, now) => {
                  await callback?.(tx, now);
                  return fileOperationResponse(
                    await fileRepository.finishOperation(tx, request.id, now),
                  );
                });
                completed = result;
                return result;
              },
            });
          } finally {
            await lease.stop();
          }
        },
        signal,
      );
    } catch (error) {
      let failure: unknown;
      try {
        // 存储层可能包装取消异常；保留失权或无效请求的原始业务原因。
        rethrowFileError(
          signal.aborted
            ? signal.reason
            : operationSignal?.aborted
              ? operationSignal.reason
              : error,
        );
      } catch (mapped) {
        failure = mapped;
      }
      const code = apiFailureCode(failure);
      if (claimed && !completed) {
        // 旧请求只移交 token 的失败事实；清理须释放物理锁后取得新租约。
        await this.identity.pool
          .query(
            'SELECT public.handoff_file_operation_failure($1::uuid,$2::uuid,$3::uuid,$4::text)',
            [context.organizationId, request.id, leaseId, code],
          )
          .then(() =>
            this.maintenance.reconcileOrganization({
              organizationId: context.organizationId,
              kind: 'operation',
              id: request.id,
            }),
          )
          .catch(() => {
            this.logger.warn({
              event: 'files.operation.handoff_pending',
              organizationId: context.organizationId,
              operationId: request.id,
              errorCode: code,
            });
          });
      }
      if (completed) return completed;
      // 已发布后的清理故障不能伪装成未执行；界面沿同一个操作查询后续收敛。
      if (published) return published;
      throw failure;
    }
  }
}
