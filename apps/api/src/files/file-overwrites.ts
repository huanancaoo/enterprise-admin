import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FileOperationResponse } from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { ApiException } from '../http/api-exception';
import { FileWriteExecutor } from './file-write-executor';
import { createFileWriteObjectPlan } from './file-object-plan';
import type { OrganizationFileOverwrite } from './file-upload-stream';
import { verifyFileUploadReplay } from './file-uploads';
import type { StorageAddress } from './storage/storage';

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
    const request = { fileId, ...fields, contentType: upload.contentType };
    return this.executor.execute(
      context,
      headers,
      {
        id: operationId,
        action: 'overwrite',
        request,
        input: {
          ...request,
          versionId: randomUUID(),
          stagingObjectId: randomUUID(),
          archiveObjectId: randomUUID(),
          replacementObjectId: randomUUID(),
          entryKind: 'file',
        },
        permissions: { file: ['upload', 'update'] },
      },
      async (scope) => {
        const input = scope.operation.input;
        const versionId = input.versionId as string;
        const stagingObjectId = input.stagingObjectId as string;
        const archiveObjectId = input.archiveObjectId as string;
        const replacementObjectId = input.replacementObjectId as string;
        const plan = await scope.write(async (tx) => {
          const file = await fileRepository.findEntry(tx, fileId, 'update');
          if (
            !file ||
            file.kind !== 'file' ||
            file.state !== 'active' ||
            !file.parentId
          )
            throw new ApiException(404, 'NOT_FOUND');
          await fileRepository.reserveUpload(tx, operationId, {
            parentId: file.parentId,
            name: file.name,
            declaredBytes: fields.declaredBytes,
            overwriteId: fileId,
            expectedRevision: fields.expectedRevision,
          });
          const versions = await fileRepository.versions(tx, fileId);
          const current = versions.find(
            (version) => version.id === file.currentVersionId,
          );
          if (!current) throw new ApiException(404, 'NOT_FOUND');
          const objects = await fileRepository.addObjects(tx, operationId, [
            {
              id: stagingObjectId,
              entryId: fileId,
              versionId,
              directory: false,
              targetArea: 'staging',
              targetPath: [versionId],
              expectedBytes: fields.declaredBytes,
              expectedSha256: fields.contentSha256,
            },
            {
              id: archiveObjectId,
              entryId: fileId,
              versionId: current.id,
              directory: false,
              sourceArea: current.storageArea,
              sourcePath: current.storagePath,
              targetArea: 'history',
              targetPath: [current.id],
              expectedBytes: current.bytes,
              expectedSha256: current.sha256,
            },
          ]);
          return { file, current, objects };
        });
        const owner = {
          kind: 'organization' as const,
          id: context.organizationId,
        };
        const staging: StorageAddress = {
          owner,
          area: 'staging',
          segments: [versionId],
        };
        const objectPlan = createFileWriteObjectPlan(
          context,
          scope,
          plan.objects,
        );
        await scope.storage.ensureOwner(owner, scope.signal);
        const newFacts = await scope.storage.write(
          staging,
          upload.source,
          fields.declaredBytes,
          scope.signal,
        );
        await upload.completed;
        await scope.write((tx) =>
          fileRepository.recordPreparedObject(
            tx,
            operationId,
            stagingObjectId,
            { ...newFacts, transientBytes: newFacts.bytes },
            scope.leaseId,
          ),
        );
        await objectPlan.prepareTargets();
        const replacement = await scope.write(async (tx) => {
          // 旧路径在这之前仍属于原版本。备份核对与删除意图确定后，才规划占据该路径的新副本。
          await fileRepository.recordSourceDeletionIntent(
            tx,
            operationId,
            archiveObjectId,
            scope.leaseId,
          );
          const [replacement] = await fileRepository.addObjects(
            tx,
            operationId,
            [
              {
                id: replacementObjectId,
                entryId: fileId,
                versionId,
                directory: false,
                sourceArea: 'staging',
                sourcePath: [versionId],
                targetArea: 'files',
                targetPath: plan.file.path,
                expectedBytes: newFacts.bytes,
                expectedSha256: newFacts.sha256,
              },
            ],
          );
          return replacement;
        });
        await objectPlan.replaceSource(archiveObjectId, replacement);
        await scope.publish((tx) =>
          fileRepository.commitUpload(tx, operationId, {
            fileId,
            versionId,
            objectId: replacementObjectId,
            parentId: plan.file.parentId!,
            name: plan.file.name,
            contentType: upload.contentType,
            expectedRevision: fields.expectedRevision,
          }),
        );
        await objectPlan.removeSources();
        return scope.complete();
      },
      {
        signal: upload.signal,
        onReuse: (_operation, signal) => verifyFileUploadReplay(upload, signal),
      },
    );
  }
}
