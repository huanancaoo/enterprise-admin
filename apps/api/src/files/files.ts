import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FileUsageResponseSchema,
  maxOrganizationUploadBytes,
  type FileBreadcrumbs,
  type FileEntryResponse,
  type FileListQuery,
  type FileOperationResponse,
  type FilePage,
  type FileVersions,
  type FileWorkspace,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import {
  fileRepository,
  type FileOperation,
} from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { FilesRuntime } from './files-runtime';
import {
  fileEntryResponse,
  fileOperationResponse,
  fileVersionResponse,
} from './file-responses';
import { rethrowFileError } from './file-http-errors';

@Injectable()
export class Files {
  constructor(
    private readonly identity: AuthRuntime,
    private readonly runtime: FilesRuntime,
    private readonly authorization: AuthorizationService,
    private readonly actors: IdentityService,
  ) {}

  private async read<T>(
    context: TenantContext,
    headers: Headers,
    load: (tx: TenantTx) => Promise<T>,
    permissions:
      | readonly PermissionRequest[]
      | ((value: T) => readonly PermissionRequest[]),
  ): Promise<T> {
    this.runtime.requireStorage();
    try {
      // 身份读取不持业务锁；最终授权与文件事实共用已借连接，避免池内互等。
      const actor = await this.actors.requireIdentity(headers);
      const client = await this.identity.pool.connect();
      try {
        return await createTenantRunner(client)(context, async (tx) => {
          // 读取也会懒初始化 workspace；与路径/上传写统一 usage→Session/status 锁序。
          await fileRepository.lockOrganization(tx);
          await fileRepository.requireCurrentActor(tx, actor.sessionId);
          const result = await load(tx);
          await this.authorization.requireAnyPermissionInTransaction(
            client,
            headers,
            context.organizationId,
            typeof permissions === 'function'
              ? permissions(result)
              : permissions,
          );
          await fileRepository.requireCurrentActor(tx, actor.sessionId);
          return result;
        }).catch((error: unknown) => rethrowTenantWriteError(error, context));
      } finally {
        client.release();
      }
    } catch (error) {
      rethrowFileError(error);
    }
  }

  async workspace(
    context: TenantContext,
    headers: Headers,
  ): Promise<FileWorkspace> {
    const { root, usage } = await this.read(
      context,
      headers,
      (tx) => fileRepository.ensureWorkspace(tx),
      [{ file: ['read'], folder: ['read'] }],
    );
    const folder = fileEntryResponse(root);
    if (folder.kind !== 'folder') throw new Error('File root is not a folder');
    return {
      root: folder,
      usage: FileUsageResponseSchema.parse({
        quotaBytes: usage.quotaBytes,
        usedBytes: usage.usedBytes,
        reservedBytes: usage.reservedBytes,
        transientBytes: usage.transientBytes,
        trashDays: usage.trashDays,
        historyDays: usage.historyDays,
        policyRevision: usage.policyRevision,
        maxUploadBytes: maxOrganizationUploadBytes,
      }),
    };
  }

  list(
    context: TenantContext,
    input: FileListQuery,
    headers: Headers,
  ): Promise<FilePage> {
    return this.read(
      context,
      headers,
      async (tx) => {
        const { root } = await fileRepository.ensureWorkspace(tx);
        const parentId = input.parentId ?? root.id;
        // 名称搜索覆盖当前组织；普通目录请求校验位置，不能误查整组织。
        if (!input.name && input.state === 'active')
          await fileRepository.breadcrumbs(tx, parentId);
        const page = await fileRepository.listPage(tx, {
          ...input,
          parentId:
            input.state === 'trashed' && input.parentId === undefined
              ? undefined
              : parentId,
        });
        return {
          ...page,
          items: page.items.map(({ entry, version }) =>
            fileEntryResponse(entry, version),
          ),
        };
      },
      input.state === 'trashed'
        ? [
            { file: ['read', 'restore'], folder: ['read'] },
            { file: ['read', 'purge'], folder: ['read'] },
          ]
        : [{ file: ['read'], folder: ['read'] }],
    );
  }

  async get(
    context: TenantContext,
    id: string,
    headers: Headers,
  ): Promise<FileEntryResponse> {
    const resource = await this.read(
      context,
      headers,
      async (tx) => {
        const entry = await fileRepository.findEntry(tx, id, 'share');
        if (!entry || entry.state !== 'active') throw new NotFoundException();
        const versions =
          entry.kind === 'file' ? await fileRepository.versions(tx, id) : [];
        return { entry, versions };
      },
      ({ entry }) => [
        entry.kind === 'file' ? { file: ['read'] } : { folder: ['read'] },
      ],
    );
    return fileEntryResponse(
      resource.entry,
      resource.versions.find((v) => v.id === resource.entry.currentVersionId),
    );
  }

  breadcrumbs(
    context: TenantContext,
    id: string,
    headers: Headers,
  ): Promise<FileBreadcrumbs> {
    return this.read(
      context,
      headers,
      async (tx) => {
        const entries = await fileRepository.breadcrumbs(tx, id);
        return {
          items: entries.map((entry) => {
            const folder = fileEntryResponse(entry);
            if (folder.kind !== 'folder') throw new Error('Invalid breadcrumb');
            return folder;
          }),
        };
      },
      [{ folder: ['read'] }],
    );
  }

  versions(
    context: TenantContext,
    id: string,
    headers: Headers,
  ): Promise<FileVersions> {
    return this.read(
      context,
      headers,
      async (tx) => {
        const entry = await fileRepository.findEntry(tx, id, 'share');
        if (!entry || entry.state !== 'active' || entry.kind !== 'file')
          throw new NotFoundException();
        const versions = await fileRepository.versions(tx, id);
        return {
          items: versions.map((version) => fileVersionResponse(entry, version)),
        };
      },
      [{ file: ['read'] }],
    );
  }

  async operation(
    context: TenantContext,
    id: string,
    headers: Headers,
  ): Promise<FileOperationResponse> {
    const operation = await this.read(
      context,
      headers,
      async (tx) => {
        const operation = await fileRepository.findOperation(tx, id);
        if (!operation) throw new NotFoundException();
        return operation;
      },
      (operation) => this.operationPermissions(context, operation),
    );
    return fileOperationResponse(operation);
  }

  private operationPermissions(
    context: TenantContext,
    operation: FileOperation,
  ): PermissionRequest[] {
    const alternatives: PermissionRequest[] = [
      { file: ['read'], folder: ['read'] },
    ];
    if (operation.actorId !== context.userId) return alternatives;
    switch (operation.action) {
      case 'create-folder':
        alternatives.push({ folder: ['create'] });
        break;
      case 'upload':
        alternatives.push({ file: ['upload'] });
        break;
      case 'overwrite':
        alternatives.push({ file: ['upload', 'update'] });
        break;
      case 'restore':
        alternatives.push({ file: ['restore'] });
        break;
      case 'purge':
        alternatives.push({ file: ['purge'] });
        break;
      case 'rename':
      case 'move':
      case 'trash': {
        const action = operation.action === 'trash' ? 'delete' : 'update';
        // 种类来自服务端受理时的不可变事实，清除后仍能按原动作查询自己的回执。
        if (operation.input.entryKind === 'file')
          alternatives.push({ file: [action] });
        if (operation.input.entryKind === 'folder')
          alternatives.push({ folder: [action] });
        break;
      }
    }
    return alternatives;
  }
}
