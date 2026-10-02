import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type CreateFolder,
  type FileOperationResponse,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { FileWriteExecutor } from './file-write-executor';

@Injectable()
export class FileWrites {
  constructor(private readonly executor: FileWriteExecutor) {}

  createFolder(
    context: TenantContext,
    headers: Headers,
    input: CreateFolder,
  ): Promise<FileOperationResponse> {
    const request = { parentId: input.parentId, name: input.name };
    return this.executor.execute(
      context,
      headers,
      {
        id: input.operationId,
        action: 'create-folder',
        request,
        input: { ...request, entryId: randomUUID() },
        permissions: { folder: ['create'] },
      },
      async (scope) => {
        const entry = {
          id: scope.operation.input.entryId as string,
          parentId: input.parentId,
          name: input.name,
        };
        // 受理事实先持久化；名称冲突等业务失败也能以同一操作身份查询。
        const plan = await scope.write((tx) =>
          fileRepository.prepareFolder(tx, input.operationId, entry),
        );
        const location = {
          owner: { kind: 'organization' as const, id: context.organizationId },
          area: 'files' as const,
          segments: plan.path,
        };
        await scope.storage.ensureOwner(location.owner, scope.signal);
        await scope.storage.createDirectory(location, scope.signal);
        await scope.write((tx) =>
          fileRepository.recordPreparedObject(
            tx,
            input.operationId,
            plan.objects[0].id,
            { bytes: 0, sha256: null, transientBytes: 0 },
            scope.leaseId,
          ),
        );
        return scope.complete((tx) =>
          fileRepository.commitFolder(tx, input.operationId, entry),
        );
      },
    );
  }
}
