import { Injectable } from '@nestjs/common';
import type { FileOperationResponse } from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { FileWriteExecutor } from './file-write-executor';
import { newOverwriteInput, runOverwrite } from './file-operation-runs';
import type { OrganizationFileOverwrite } from './file-upload-stream';

@Injectable()
export class FileOverwrites {
  constructor(private readonly executor: FileWriteExecutor) {}

  overwrite(
    context: TenantContext,
    headers: Headers,
    fileId: string,
    upload: OrganizationFileOverwrite,
  ): Promise<FileOperationResponse> {
    const { operationId, ...fields } = upload.fields;
    const { request, input } = newOverwriteInput(
      fileId,
      fields,
      upload.contentType,
    );
    return this.executor.execute(
      context,
      headers,
      {
        id: operationId,
        action: 'overwrite',
        request,
        input,
        permissions: { file: ['upload', 'update'] },
      },
      (scope) =>
        runOverwrite(scope, context, fileId, operationId, fields, upload),
      {
        signal: upload.signal,
        onReuse: (_operation, signal) => upload.verifyReplay(signal),
      },
    );
  }
}
