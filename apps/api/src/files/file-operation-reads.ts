import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { FileOperationResponse } from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import {
  fileBatchRootRequest,
  fileRepository,
  type FileBatch,
  type FileBatchItem,
  type FileOperation,
} from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { rethrowFileError } from './file-http-errors';
import { filePathPermissions } from './file-path-writes';
import { fileOperationResponse } from './file-responses';
import { FilesRuntime } from './files-runtime';

export function fileBatchActionPermissions(
  action: FileBatch['action'],
): PermissionRequest[] {
  if (action === 'restore' || action === 'purge') return [{ file: [action] }];
  const verb = action === 'move' ? 'update' : 'delete';
  return [{ file: [verb] }, { folder: [verb] }];
}

type FileBatchRootObservation = {
  operation: FileOperationResponse | null;
  errorCode: 'NOT_FOUND' | 'IDEMPOTENCY_KEY_REUSED' | null;
};

@Injectable()
export class FileOperationReads {
  constructor(
    private readonly identity: AuthRuntime,
    private readonly actors: IdentityService,
    private readonly authorization: AuthorizationService,
    private readonly runtime: FilesRuntime,
  ) {}

  private async observe<T>(
    context: TenantContext,
    headers: Headers,
    read: (tx: TenantTx, client: PoolClient) => Promise<T>,
  ): Promise<T> {
    this.runtime.requireStorage();
    try {
      // 身份读取先于 usage 锁；最终授权复用持锁连接，避免身份连接与业务锁互等。
      const actor = await this.actors.requireIdentity(headers);
      const client = await this.identity.pool.connect();
      try {
        return await createTenantRunner(client)(context, async (tx) => {
          await fileRepository.lockOrganization(tx);
          await fileRepository.requireCurrentActor(tx, actor.sessionId);
          const result = await read(tx, client);
          // 授权或事实读取可能等待；返回前仍以数据库时钟检查会话实际到期时间。
          await fileRepository.requireCurrentActor(tx, actor.sessionId);
          return result;
        }).catch((error: unknown) => rethrowTenantWriteError(error, context));
      } finally {
        client.release();
      }
    } catch (error) {
      rethrowFileError(error);
    }
  }

  operation(
    context: TenantContext,
    id: string,
    headers: Headers,
  ): Promise<FileOperationResponse> {
    return this.observe(context, headers, async (tx, client) => {
      const operation = await fileRepository.findOperation(tx, id);
      if (!operation) throw new NotFoundException();
      await this.authorization.requireAnyPermissionInTransaction(
        client,
        headers,
        context.organizationId,
        this.operationPermissions(context, operation),
      );
      return fileOperationResponse(operation);
    });
  }

  batchRoot(
    context: TenantContext,
    headers: Headers,
    batch: FileBatch,
    root: FileBatchItem,
  ): Promise<FileBatchRootObservation> {
    return this.observe<FileBatchRootObservation>(
      context,
      headers,
      async (tx, client) => {
        const choices: PermissionRequest[] = [
          { file: ['read'], folder: ['read'] },
        ];
        if (batch.actorId === context.userId)
          choices.push(
            ...(root.entryKind
              ? [filePathPermissions(root.entryKind, batch.action)]
              : fileBatchActionPermissions(batch.action)),
          );
        // 未受理和身份冲突也只向获准观察本批次的成员公开，不能先套用其他操作的权限。
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          choices,
        );
        const operation = await fileRepository.findOperation(
          tx,
          root.operationId,
        );
        if (!root.entryKind) return { operation: null, errorCode: 'NOT_FOUND' };
        if (!operation) return { operation: null, errorCode: null };
        const requestHash = createHash('sha256')
          .update(JSON.stringify(fileBatchRootRequest(batch, root)))
          .digest('hex');
        if (
          operation.actorId !== batch.actorId ||
          operation.action !== batch.action ||
          operation.requestHash !== requestHash
        )
          return { operation: null, errorCode: 'IDEMPOTENCY_KEY_REUSED' };
        // 同一事务里的受理事实通过核对后，才允许按该操作本人的原动作权限返回收据。
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          this.operationPermissions(context, operation),
        );
        return {
          operation: fileOperationResponse(operation),
          errorCode: null,
        };
      },
    );
  }

  private operationPermissions(
    context: TenantContext,
    operation: FileOperation,
  ): PermissionRequest[] {
    const alternatives: PermissionRequest[] = [
      { file: ['read'], folder: ['read'] },
    ];
    if (operation.actorId !== context.userId) return alternatives;
    switch (operation.action) {
      case 'create-folder':
        alternatives.push({ folder: ['create'] });
        break;
      case 'upload':
        alternatives.push({ file: ['upload'] });
        break;
      case 'overwrite':
        alternatives.push({ file: ['upload', 'update'] });
        break;
      case 'restore':
        alternatives.push({ file: ['restore'] });
        break;
      case 'purge':
        alternatives.push({ file: ['purge'] });
        break;
      case 'rename':
      case 'move':
      case 'trash': {
        const action = operation.action === 'trash' ? 'delete' : 'update';
        // 种类来自受理时的不可变事实；清除后仍能按原动作查询本人的收据。
        if (operation.input.entryKind === 'file')
          alternatives.push({ file: [action] });
        if (operation.input.entryKind === 'folder')
          alternatives.push({ folder: [action] });
        break;
      }
    }
    return alternatives;
  }
}
