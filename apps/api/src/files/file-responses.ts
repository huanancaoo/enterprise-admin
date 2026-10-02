import { NotFoundException } from '@nestjs/common';
import {
  FileOperationErrorCodeSchema,
  FileOperationResponseSchema,
  FileResponseSchema,
  FileVersionResponseSchema,
  FolderResponseSchema,
  type FileEntryResponse,
  type FileOperationResponse,
  type FileVersionResponse,
} from '@workspace/contracts';
import type {
  FileEntry,
  FileOperation,
  FileVersion,
} from '@workspace/database/repositories/files';

export function filePreviewKind(
  contentType: string,
): FileVersionResponse['previewKind'] {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime))
    return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/plain' || mime === 'application/json') return 'text';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'none';
}

export function fileVersionResponse(
  entry: FileEntry,
  version: FileVersion,
): FileVersionResponse {
  return FileVersionResponseSchema.parse({
    id: version.id,
    fileId: version.fileId,
    bytes: version.bytes,
    contentType: version.contentType,
    sha256: version.sha256,
    previewKind: filePreviewKind(version.contentType),
    isCurrent: entry.currentVersionId === version.id,
    createdAt: version.createdAt.toISOString(),
    retiredAt: version.retiredAt?.toISOString() ?? null,
    expiresAt: version.expiresAt?.toISOString() ?? null,
  });
}

export function fileEntryResponse(
  entry: FileEntry,
  version?: FileVersion | null,
): FileEntryResponse {
  if (entry.state === 'purged') throw new NotFoundException();
  const fields = {
    id: entry.id,
    organizationId: entry.organizationId,
    parentId: entry.parentId,
    name: entry.name,
    path: entry.path,
    revision: entry.revision,
    state: entry.state,
    operationId: entry.busyOperationId,
    deletedAt: entry.deletedAt?.toISOString() ?? null,
    expiresAt: entry.expiresAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
  if (entry.kind === 'folder')
    return FolderResponseSchema.parse({ ...fields, kind: 'folder' });
  if (!version || version.id !== entry.currentVersionId || version.purgedAt)
    throw new Error('Published file current version is missing');
  return FileResponseSchema.parse({
    ...fields,
    kind: 'file',
    currentVersion: fileVersionResponse(entry, version),
  });
}

export function fileOperationResponse(
  operation: FileOperation,
): FileOperationResponse {
  const error = FileOperationErrorCodeSchema.safeParse(operation.errorCode);
  return FileOperationResponseSchema.parse({
    id: operation.id,
    action: operation.action,
    phase: operation.phase,
    committedAt: operation.committedAt?.toISOString() ?? null,
    completedAt: operation.completedAt?.toISOString() ?? null,
    errorCode:
      operation.errorCode === null
        ? null
        : error.success
          ? error.data
          : 'INTERNAL_ERROR',
    result: operation.result,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
  });
}
