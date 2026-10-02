import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { FileOperationResponse } from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { ApiException } from '../http/api-exception';
import { FileWriteExecutor } from './file-write-executor';
import type {
  FileUploadStream,
  OrganizationFileUpload,
} from './file-upload-stream';

export async function verifyFileUploadReplay(
  upload: FileUploadStream<{ declaredBytes: number; contentSha256: string }>,
  signal: AbortSignal,
): Promise<void> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of upload.source) {
    signal.throwIfAborted();
    bytes += chunk.byteLength;
    if (bytes > upload.fields.declaredBytes)
      throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
    hash.update(chunk);
  }
  await upload.completed;
  signal.throwIfAborted();
  if (
    bytes !== upload.fields.declaredBytes ||
    hash.digest('hex') !== upload.fields.contentSha256
  )
    throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
}

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
        const facts = await scope.storage.write(
          address,
          upload.source,
          fields.declaredBytes,
          scope.signal,
        );
        // 文件流结束不等于 multipart 结束；多余字段或第二个文件不得发布。
        await upload.completed;
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
        // 同一声明摘要仍须核对重传的真实内容，不能把不同文件当作成功重放。
        onReuse: (_operation, signal) => verifyFileUploadReplay(upload, signal),
      },
    );
  }
}
