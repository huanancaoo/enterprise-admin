import { Injectable } from '@nestjs/common';
import type { FileOperationResponse } from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { FileWriteExecutor } from './file-write-executor';
import { newUploadInput, runUpload } from './file-operation-runs';
import type { OrganizationFileUpload } from './file-upload-stream';

@Injectable()
export class FileUploads {
  constructor(private readonly executor: FileWriteExecutor) {}

  upload(
    context: TenantContext,
    headers: Headers,
    upload: OrganizationFileUpload,
  ): Promise<FileOperationResponse> {
    const { operationId, ...fields } = upload.fields;
    const { request, input } = newUploadInput(fields, upload.contentType);
    return this.executor.execute(
      context,
      headers,
      {
        id: operationId,
        action: 'upload',
        request,
        input,
        permissions: { file: ['upload'] },
      },
      (scope) => runUpload(scope, context, operationId, fields, upload),
      {
        signal: upload.signal,
        onReuse: (_operation, signal) => upload.verifyReplay(signal),
      },
    );
  }
}
