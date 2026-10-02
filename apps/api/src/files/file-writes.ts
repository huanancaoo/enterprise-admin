import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  type CreateFolder,
  type FileOperationResponse,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { ApiException } from '../http/api-exception';
import { apiFailureCode } from '../http/api-error.filter';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { FilesRuntime } from './files-runtime';
import { FileLease } from './file-lease';
import { FileMaintenance } from './file-maintenance';
import { fileOperationResponse } from './file-responses';
import { rethrowFileError } from './file-http-errors';
import { StorageError } from './storage/storage';
import type { PoolClient } from 'pg';

@Injectable()
export class FileWrites implements OnModuleDestroy {
  private readonly logger = new Logger(FileWrites.name);
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

  async createFolder(
    context: TenantContext,
    headers: Headers,
    input: CreateFolder,
  ): Promise<FileOperationResponse> {
    const task = this.performFolder(context, headers, input);
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
  ): Promise<Date> {
    await fileRepository.lockOrganization(tx);
    const actor = await this.actors.requireIdentity(headers);
    await fileRepository.requireCurrentActor(tx, actor.sessionId);
    await this.authorization.requirePermissionInTransaction(
      client,
      headers,
      tx.context.organizationId,
      { folder: ['create'] },
    );
    // 会话/成员锁保护撤销时序；原生授权等待结束后再次检查实际到期时间。
    return fileRepository.requireCurrentActor(tx, actor.sessionId);
  }

  private async performFolder(
    context: TenantContext,
    headers: Headers,
    input: CreateFolder,
  ): Promise<FileOperationResponse> {
    const storage = this.runtime.requireStorage();
    const leaseId = randomUUID();
    let claimed = false;
    let published: FileOperationResponse | undefined;
    try {
      return await this.runtime.requirePhysicalScope().run(
        { kind: 'organization', id: context.organizationId },
        async (scopeSignal, client) => {
          // 续租与业务写共享持有物理锁的连接，必须串行，不能在同一连接重叠开启事务。
          let pending: Promise<unknown> = Promise.resolve();
          const transaction = <T>(work: (tx: TenantTx) => Promise<T>) => {
            const result = pending.then(() =>
              createTenantRunner(client)(context, work).catch(
                (error: unknown) => rethrowTenantWriteError(error, context),
              ),
            );
            pending = result.then(
              () => {},
              () => {},
            );
            return result;
          };
          const started = performance.now();
          const admission = await transaction(async (tx) => {
            const now = await this.currentActor(tx, client, headers);
            const request = { parentId: input.parentId, name: input.name };
            const begun = await fileRepository.beginOperation(tx, {
              id: input.operationId,
              action: 'create-folder',
              input: { ...request, entryId: randomUUID() },
              requestHash: createHash('sha256')
                .update(JSON.stringify(request))
                .digest('hex'),
              expiresAt: new Date(now.getTime() + 86_400_000),
            });
            if (begun.reused) return { ...begun, now };
            const operation = await fileRepository.claimOperation(
              tx,
              input.operationId,
              leaseId,
              now,
            );
            if (!operation)
              throw new ApiException(409, 'FILE_OPERATION_IN_PROGRESS');
            // 提交确认丢失时仍以当前 token 移交；固定函数只接受实际已持久化的认领。
            claimed = true;
            return { operation, reused: false, now };
          });
          if (admission.reused)
            return fileOperationResponse(admission.operation);
          const entry = {
            id: admission.operation.input.entryId as string,
            parentId: input.parentId,
            name: input.name,
          };
          const lease = new FileLease(
            admission.operation.leaseExpiresAt!.getTime() -
              admission.now.getTime() -
              (performance.now() - started),
            scopeSignal,
            async () => {
              const renewStarted = performance.now();
              const renewed = await transaction(async (tx) => {
                const now = await this.currentActor(tx, client, headers);
                const operation = await fileRepository.renewOperation(
                  tx,
                  input.operationId,
                  leaseId,
                  now,
                );
                return operation.leaseExpiresAt!.getTime() - now.getTime();
              });
              return renewed - (performance.now() - renewStarted);
            },
          );
          const write = <T>(work: (tx: TenantTx) => Promise<T>) =>
            transaction(async (tx) => {
              lease.signal.throwIfAborted();
              const now = await this.currentActor(tx, client, headers);
              await fileRepository.renewOperation(
                tx,
                input.operationId,
                leaseId,
                now,
              );
              lease.signal.throwIfAborted();
              return work(tx);
            });
          try {
            // 受理事实先提交；名称冲突等业务失败也能以同一个操作身份查询。
            const plan = await write((tx) =>
              fileRepository.prepareFolder(tx, input.operationId, entry),
            );
            const location = {
              owner: {
                kind: 'organization' as const,
                id: context.organizationId,
              },
              area: 'files' as const,
              segments: plan.path,
            };
            await storage.ensureOwner(location.owner, lease.signal);
            await storage.createDirectory(location, lease.signal);
            await write((tx) =>
              fileRepository.recordPreparedObject(
                tx,
                input.operationId,
                plan.objects[0].id,
                { bytes: 0, sha256: null, transientBytes: 0 },
                leaseId,
              ),
            );
            await lease.stop();
            published = await write(async (tx) => {
              await fileRepository.commitFolder(tx, input.operationId, entry);
              return fileOperationResponse(
                await fileRepository.finishOperation(
                  tx,
                  input.operationId,
                  new Date(),
                ),
              );
            });
            return published;
          } finally {
            await lease.stop();
          }
        },
        this.shutdown.signal,
      );
    } catch (error) {
      let failure: unknown;
      try {
        rethrowFileError(error);
      } catch (mapped) {
        failure = mapped;
      }
      const code = apiFailureCode(failure);
      if (claimed && !published) {
        // 旧请求只移交 token 的失败事实；清理必须在释放物理锁后取得新租约。
        await this.identity.pool
          .query(
            'SELECT public.handoff_file_operation_failure($1::uuid,$2::uuid,$3::uuid,$4::text)',
            [context.organizationId, input.operationId, leaseId, code],
          )
          .then(() =>
            this.maintenance.reconcileOrganization({
              organizationId: context.organizationId,
              kind: 'operation',
              id: input.operationId,
            }),
          )
          .catch(() => {
            this.logger.warn({
              event: 'files.operation.handoff_pending',
              organizationId: context.organizationId,
              operationId: input.operationId,
              errorCode: code,
            });
          });
      }
      if (published) return published;
      throw failure;
    }
  }
}
