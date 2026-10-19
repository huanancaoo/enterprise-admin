import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FileEntryImpactSchema,
  type FileEntryImpact,
  type FileOperationResponse,
  type MoveFileEntry,
  type PurgeFileEntry,
  type RenameFileEntry,
  type RestoreFileEntry,
  type TrashFileEntry,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import {
  fileRepository,
  type FileEntry,
} from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { FileOrganizationSession } from './file-organization-session';
import { FileWriteExecutor } from './file-write-executor';
import { runPathOperation } from './file-operation-runs';

type PathAction = 'rename' | 'move' | 'trash' | 'restore' | 'purge';
type PathInput =
  | RenameFileEntry
  | MoveFileEntry
  | TrashFileEntry
  | RestoreFileEntry
  | PurgeFileEntry;

export function filePathPermissions(
  kind: FileEntry['kind'],
  action: PathAction,
): PermissionRequest {
  if (action === 'restore' || action === 'purge') return { file: [action] };
  const permission = action === 'trash' ? 'delete' : 'update';
  return kind === 'file' ? { file: [permission] } : { folder: [permission] };
}

@Injectable()
export class FilePathWrites {
  constructor(
    private readonly identity: AuthRuntime,
    private readonly authorization: AuthorizationService,
    private readonly executor: FileWriteExecutor,
    private readonly session: FileOrganizationSession,
  ) {}

  private async entry(context: TenantContext, id: string): Promise<FileEntry> {
    const entry = await createTenantRunner(this.identity.pool)(context, (tx) =>
      fileRepository.findEntry(tx, id),
    );
    if (!entry) throw new NotFoundException();
    return entry;
  }

  async impact(
    context: TenantContext,
    headers: Headers,
    id: string,
    action: 'trash' | 'purge',
  ): Promise<FileEntryImpact> {
    const entry = await this.entry(context, id);
    return this.session.open(context, headers, async (scope) => {
      await this.authorization.requirePermissionInTransaction(
        scope.client,
        headers,
        context.organizationId,
        filePathPermissions(entry.kind, action),
      );
      await scope.recheckActor();
      return FileEntryImpactSchema.parse(
        await fileRepository.entryImpact(scope.tx, id, action),
      );
    });
  }

  async perform(
    context: TenantContext,
    headers: Headers,
    entryId: string,
    action: PathAction,
    input: PathInput,
    batch?: {
      id: string;
      requestHash: string;
      selected: { entryId: string; expectedRevision: number }[];
    },
  ): Promise<FileOperationResponse> {
    const entry = await this.entry(context, entryId);
    const { operationId, ...fields } = input;
    const request = {
      entryId,
      ...fields,
      ...(batch
        ? { batchId: batch.id, batchRequestHash: batch.requestHash }
        : {}),
    };
    return this.executor.execute(
      context,
      headers,
      {
        id: operationId,
        action,
        request,
        input: {
          ...request,
          entryKind: entry.kind,
          ...(batch ? { selected: batch.selected } : {}),
        },
        permissions: filePathPermissions(entry.kind, action),
      },
      (scope) =>
        runPathOperation(
          scope,
          context,
          operationId,
          entryId,
          action,
          input,
          batch,
        ),
    );
  }
}
