import { randomUUID } from 'node:crypto';
import type { FileOperationResponse } from '@workspace/contracts';
import type {
  MoveFileEntry,
  PurgeFileEntry,
  RenameFileEntry,
  RestoreFileEntry,
  TrashFileEntry,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  fileRepository,
  type FileEntry,
} from '@workspace/database/repositories/files';
import { ApiException } from '../http/api-exception';
import type { FileWriteScope } from './file-write-executor';
import { createFileWriteObjectPlan } from './file-object-plan';
import type {
  OrganizationFileOverwrite,
  OrganizationFileUpload,
} from './file-upload-stream';
import type { StorageAddress } from './storage/storage';

type PathAction = 'rename' | 'move' | 'trash' | 'restore' | 'purge';
type PathInput =
  | RenameFileEntry
  | MoveFileEntry
  | TrashFileEntry
  | RestoreFileEntry
  | PurgeFileEntry;

// 发布、清理和未知结果的顺序只在这里排。各动词的 SQL 事实不同，顺序不在调用方。
export async function runCreateFolder(
  scope: FileWriteScope,
  context: TenantContext,
  input: { operationId: string; parentId: string; name: string },
): Promise<FileOperationResponse> {
  const entry = {
    id: scope.operation.input.entryId as string,
    parentId: input.parentId,
    name: input.name,
  };
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
}

export function newUploadInput(
  fields: Omit<OrganizationFileUpload['fields'], 'operationId'>,
  contentType: string,
) {
  const request = { ...fields, contentType };
  return {
    request: { ...request, contentType },
    input: {
      ...request,
      contentType,
      fileId: randomUUID(),
      versionId: randomUUID(),
      objectId: randomUUID(),
      entryKind: 'file' as const,
    },
  };
}

export async function runUpload(
  scope: FileWriteScope,
  context: TenantContext,
  operationId: string,
  fields: Omit<OrganizationFileUpload['fields'], 'operationId'>,
  upload: OrganizationFileUpload,
): Promise<FileOperationResponse> {
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
  const facts = await upload.writeTo(scope.storage, address, scope.signal);
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
}

export function newOverwriteInput(
  fileId: string,
  fields: Omit<OrganizationFileOverwrite['fields'], 'operationId'>,
  contentType: string,
) {
  const request = { fileId, ...fields, contentType };
  return {
    request,
    input: {
      ...request,
      versionId: randomUUID(),
      stagingObjectId: randomUUID(),
      archiveObjectId: randomUUID(),
      replacementObjectId: randomUUID(),
      entryKind: 'file' as const,
    },
  };
}

export async function runOverwrite(
  scope: FileWriteScope,
  context: TenantContext,
  fileId: string,
  operationId: string,
  fields: Omit<OrganizationFileOverwrite['fields'], 'operationId'>,
  upload: OrganizationFileOverwrite,
): Promise<FileOperationResponse> {
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
  const owner = { kind: 'organization' as const, id: context.organizationId };
  const staging: StorageAddress = {
    owner,
    area: 'staging',
    segments: [versionId],
  };
  const objectPlan = createFileWriteObjectPlan(context, scope, plan.objects);
  await scope.storage.ensureOwner(owner, scope.signal);
  const newFacts = await upload.writeTo(scope.storage, staging, scope.signal);
  await scope.write((tx) =>
    fileRepository.recordPreparedObject(
      tx,
      operationId,
      stagingObjectId,
      { ...newFacts, transientBytes: newFacts.bytes },
      scope.leaseId,
    ),
  );
  await objectPlan.replaceSource({
    archiveObjectId,
    stagingObjectId,
    replacementObjectId,
    content: newFacts,
  });
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
}

export async function runPathOperation(
  scope: FileWriteScope,
  context: TenantContext,
  operationId: string,
  entryId: string,
  action: PathAction,
  input: PathInput,
  batch?: {
    selected: { entryId: string; expectedRevision: number }[];
  },
): Promise<FileOperationResponse> {
  const { objects } = await scope.write((tx, now) =>
    fileRepository.preparePathOperation(tx, operationId, {
      entryId,
      expectedRevision: input.expectedRevision,
      selected: batch?.selected,
      parentId: 'parentId' in input ? input.parentId : undefined,
      name: 'name' in input ? input.name : undefined,
      now,
    }),
  );
  await scope.storage.ensureOwner(
    { kind: 'organization', id: context.organizationId },
    scope.signal,
  );
  const objectPlan = createFileWriteObjectPlan(context, scope, objects);
  if (action !== 'purge') {
    await objectPlan.prepareTargets();
    await scope.publish((tx, now) =>
      fileRepository.commitPathOperation(tx, operationId, now),
    );
  }
  await objectPlan.removeSources();
  // purge 的物理删除不可撤销，只有删除事实、生命周期和同事务审计都成功后才发布完成。
  return scope.complete(
    action === 'purge'
      ? (tx, now) => fileRepository.commitPathOperation(tx, operationId, now)
      : undefined,
  );
}

export type { FileEntry };
