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
import { IdentityService } from '../identity/identity.service';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { FileWriteExecutor } from './file-write-executor';
import { rethrowFileError } from './file-http-errors';
import { createFileWriteObjectPlan } from './file-object-plan';

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
    private readonly actors: IdentityService,
    private readonly authorization: AuthorizationService,
    private readonly executor: FileWriteExecutor,
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
    const actor = await this.actors.requireIdentity(headers);
    const client = await this.identity.pool.connect();
    try {
      return await createTenantRunner(client)(context, async (tx) => {
        await fileRepository.lockOrganization(tx);
        await fileRepository.requireCurrentActor(tx, actor.sessionId);
        await this.authorization.requirePermissionInTransaction(
          client,
          headers,
          context.organizationId,
          filePathPermissions(entry.kind, action),
        );
        await fileRepository.requireCurrentActor(tx, actor.sessionId);
        return FileEntryImpactSchema.parse(
          await fileRepository.entryImpact(tx, id, action),
        );
      }).catch((error: unknown) => rethrowTenantWriteError(error, context));
    } catch (error) {
      rethrowFileError(error);
    } finally {
      client.release();
    }
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
      async (scope) => {
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
            ? (tx, now) =>
                fileRepository.commitPathOperation(tx, operationId, now)
            : undefined,
        );
      },
    );
  }
}
