import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FileOperationResponse } from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { ApiException } from '../http/api-exception';
import { FileWriteExecutor } from './file-write-executor';
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
    const request = { ...fields, contentType: upload.contentType };
    return this.executor.execute(
      context,
      headers,
      {
        id: operationId,
        action: 'upload',
        request,
        input: {
          ...request,
          fileId: randomUUID(),
          versionId: randomUUID(),
          objectId: randomUUID(),
          entryKind: 'file',
        },
        permissions: { file: ['upload'] },
      },
      async (scope) => {
        const input = scope.operation.input;
        const fileId = input.fileId as string;
        const versionId = input.versionId as string;
        const objectId = input.objectId as string;
        const path = await scope.write(async (tx) => {
          await fileRepository.reserveUpload(tx, operationId, fields);
          const folder = await fileRepository.findEntry(tx, fields.parentId);
          if (!folder) throw new ApiException(404, 'NOT_FOUND');
          const path = [...folder.path, fields.name];
          await fileRepository.addObjects(tx, operationId, [
            {
              id: objectId,
              entryId: fileId,
              versionId,
              directory: false,
              targetArea: 'files',
              targetPath: path,
              expectedBytes: fields.declaredBytes,
              expectedSha256: fields.contentSha256,
            },
          ]);
          return path;
        });
        const address = {
          owner: { kind: 'organization' as const, id: context.organizationId },
          area: 'files' as const,
          segments: path,
        };
        await scope.storage.ensureOwner(address.owner, scope.signal);
        const facts = await upload.writeTo(
          scope.storage,
          address,
          scope.signal,
        );
        await scope.write((tx) =>
          fileRepository.recordPreparedObject(
            tx,
            operationId,
            objectId,
            { ...facts, transientBytes: 0 },
            scope.leaseId,
          ),
        );
        return scope.complete((tx) =>
          fileRepository.commitUpload(tx, operationId, {
            fileId,
            versionId,
            objectId,
            parentId: fields.parentId,
            name: fields.name,
            contentType: upload.contentType,
          }),
        );
      },
      {
        signal: upload.signal,
        onReuse: (_operation, signal) => upload.verifyReplay(signal),
      },
    );
  }
}
