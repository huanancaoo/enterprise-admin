import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type CreateFolder,
  type FileOperationResponse,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { FileWriteExecutor } from './file-write-executor';
import { runCreateFolder } from './file-operation-runs';

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
        // 受理事实先持久化；名称冲突等业务失败也能以同一操作身份查询。
        input: { ...request, entryId: randomUUID() },
        permissions: { folder: ['create'] },
      },
      (scope) => runCreateFolder(scope, context, input),
    );
  }
}
