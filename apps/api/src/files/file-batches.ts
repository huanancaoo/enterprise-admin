import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FileBatchResponseSchema,
  FileOperationErrorCodeSchema,
  type ExecuteFileBatch,
  type FileBatchItemResponse,
  type FileBatchResponse,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import {
  fileRepository,
  type FileBatch,
  type FileBatchItem,
} from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { apiFailureCode } from '../http/api-error.filter';
import { ApiException } from '../http/api-exception';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { rethrowFileError } from './file-http-errors';
import {
  FileOperationReads,
  fileBatchActionPermissions,
} from './file-operation-reads';
import { FilesRuntime } from './files-runtime';
import { FilePathWrites } from './file-path-writes';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

function publicError(
  error: unknown,
): NonNullable<FileBatchItemResponse['error']> {
  const code = FileOperationErrorCodeSchema.safeParse(apiFailureCode(error));
  return {
    code: code.success ? code.data : 'INTERNAL_ERROR',
    ...(error instanceof ApiException && error.details
      ? { details: error.details }
      : {}),
  };
}

@Injectable()
export class FileBatches {
  constructor(
    private readonly identity: AuthRuntime,
    private readonly actors: IdentityService,
    private readonly authorization: AuthorizationService,
    private readonly paths: FilePathWrites,
    private readonly receipts: FileOperationReads,
    private readonly runtime: FilesRuntime,
  ) {}

  private async plan(
    context: TenantContext,
    headers: Headers,
    id: string,
    input?: ExecuteFileBatch,
  ) {
    this.runtime.requireStorage();
    const actor = await this.actors.requireIdentity(headers);
    const client = await this.identity.pool.connect();
    try {
      return await createTenantRunner(client)(context, async (tx) => {
        await fileRepository.lockOrganization(tx);
        await fileRepository.requireCurrentActor(tx, actor.sessionId);
        const existing = await fileRepository.findBatch(tx, id);
        if (!input && !existing) throw new NotFoundException();
        const choices: PermissionRequest[] = [
          { file: ['read'], folder: ['read'] },
        ];
        if (input)
          choices.splice(
            0,
            choices.length,
            ...fileBatchActionPermissions(input.action),
          );
        else if (existing!.batch.actorId === context.userId)
          choices.push(...fileBatchActionPermissions(existing!.batch.action));
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          choices,
        );
        await fileRepository.requireCurrentActor(tx, actor.sessionId);
        return input
          ? fileRepository.beginBatch(tx, {
              id,
              requestHash: hash({
                action: input.action,
                parentId: 'parentId' in input ? (input.parentId ?? null) : null,
                items: input.items.map((item) => ({
                  entryId: item.entryId,
                  expectedRevision: item.expectedRevision,
                  operationId: item.operationId,
                })),
              }),
              action: input.action,
              items: input.items,
              parentId: 'parentId' in input ? input.parentId : undefined,
            })
          : existing!;
      }).catch((error: unknown) => rethrowTenantWriteError(error, context));
    } catch (error) {
      rethrowFileError(error);
    } finally {
      client.release();
    }
  }

  async execute(
    context: TenantContext,
    headers: Headers,
    input: ExecuteFileBatch,
  ): Promise<FileBatchResponse> {
    const plan = await this.plan(context, headers, input.batchId, input);
    const errors = new Map<
      number,
      NonNullable<FileBatchItemResponse['error']>
    >();
    // 每个根沿已有 owner scope 和自己的 token 执行；不能在外层持同一个物理锁后递归获取。
    for (const root of plan.items.filter(
      (item) => item.index === item.rootIndex,
    )) {
      if (!root.entryKind) continue;
      try {
        await this.paths.perform(
          context,
          headers,
          root.entryId,
          plan.batch.action,
          {
            operationId: root.operationId,
            expectedRevision: root.expectedRevision,
            ...(plan.batch.parentId ? { parentId: plan.batch.parentId } : {}),
          },
          {
            id: plan.batch.id,
            requestHash: plan.batch.requestHash,
            selected: plan.items
              .filter((item) => item.rootIndex === root.index)
              .map((item) => ({
                entryId: item.entryId,
                expectedRevision: item.expectedRevision,
              })),
          },
        );
      } catch (error) {
        errors.set(root.index, publicError(error));
      }
    }
    return this.view(context, headers, plan, errors);
  }

  async get(
    context: TenantContext,
    headers: Headers,
    id: string,
  ): Promise<FileBatchResponse> {
    return this.view(context, headers, await this.plan(context, headers, id));
  }

  private async view(
    context: TenantContext,
    headers: Headers,
    plan: { batch: FileBatch; items: FileBatchItem[] },
    errors = new Map<number, NonNullable<FileBatchItemResponse['error']>>(),
  ): Promise<FileBatchResponse> {
    const roots = new Map<
      number,
      Pick<FileBatchItemResponse, 'state' | 'operation' | 'error'>
    >();
    for (const root of plan.items.filter(
      (item) => item.index === item.rootIndex,
    )) {
      try {
        const observed = await this.receipts.batchRoot(
          context,
          headers,
          plan.batch,
          root,
        );
        if (observed.errorCode) {
          roots.set(root.index, {
            state: 'failed',
            operation: null,
            error: { code: observed.errorCode },
          });
          continue;
        }
        const receipt = observed.operation;
        if (!receipt) {
          roots.set(root.index, {
            state: errors.has(root.index) ? 'unavailable' : 'pending',
            operation: null,
            error: errors.get(root.index) ?? null,
          });
          continue;
        }
        roots.set(root.index, {
          state: receipt.phase,
          operation: receipt,
          error: receipt.errorCode ? { code: receipt.errorCode } : null,
        });
      } catch (error) {
        roots.set(root.index, {
          state: 'unavailable',
          operation: null,
          error: publicError(error),
        });
      }
    }
    return FileBatchResponseSchema.parse({
      batchId: plan.batch.id,
      action: plan.batch.action,
      createdAt: plan.batch.createdAt.toISOString(),
      items: plan.items.map((item) => ({
        index: item.index,
        entryId: item.entryId,
        requestedOperationId: item.operationId,
        rootIndex: item.rootIndex,
        operationId: plan.items[item.rootIndex].operationId,
        ...roots.get(item.rootIndex),
        ...(item.index !== item.rootIndex ? { state: 'covered' } : {}),
      })),
    });
  }
}
