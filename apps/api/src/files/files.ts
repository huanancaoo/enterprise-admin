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
} from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import { runTenantWrite } from '../tenancy/tenant-write';
import { AuthorizationService } from '../authorization/authorization.service';
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
  ) {}

  async workspace(context: TenantContext): Promise<FileWorkspace> {
    this.runtime.requireStorage();
    const { root, usage } = await runTenantWrite(
      this.identity.pool,
      context,
      (tx) => fileRepository.ensureWorkspace(tx),
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

  async list(context: TenantContext, input: FileListQuery): Promise<FilePage> {
    this.runtime.requireStorage();
    try {
      return await runTenantWrite(this.identity.pool, context, async (tx) => {
        const { root } = await fileRepository.ensureWorkspace(tx);
        const parentId = input.parentId ?? root.id;
        // 名称搜索覆盖当前组织；普通目录请求必须校验位置，不能误查整组织。
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
      });
    } catch (error) {
      rethrowFileError(error);
    }
  }

  async get(
    context: TenantContext,
    id: string,
    headers: Headers,
  ): Promise<FileEntryResponse> {
    this.runtime.requireStorage();
    const resource = await createTenantRunner(this.identity.pool)(
      context,
      (tx) => fileRepository.findEntry(tx, id),
    );
    if (!resource || resource.state !== 'active') throw new NotFoundException();
    await this.authorization.requirePermission(
      headers,
      context.organizationId,
      resource.kind === 'file' ? { file: ['read'] } : { folder: ['read'] },
    );
    return createTenantRunner(this.identity.pool)(context, async (tx) => {
      const entry = await fileRepository.findEntry(tx, id, 'share');
      if (!entry || entry.state !== 'active') throw new NotFoundException();
      const versions =
        entry.kind === 'file' ? await fileRepository.versions(tx, id) : [];
      return fileEntryResponse(
        entry,
        versions.find((version) => version.id === entry.currentVersionId),
      );
    });
  }

  async breadcrumbs(
    context: TenantContext,
    id: string,
  ): Promise<FileBreadcrumbs> {
    this.runtime.requireStorage();
    try {
      return await createTenantRunner(this.identity.pool)(
        context,
        async (tx) => {
          await fileRepository.lockOrganization(tx);
          const entries = await fileRepository.breadcrumbs(tx, id);
          const items = entries.map((entry) => {
            const folder = fileEntryResponse(entry);
            if (folder.kind !== 'folder') throw new Error('Invalid breadcrumb');
            return folder;
          });
          return { items };
        },
      );
    } catch (error) {
      rethrowFileError(error);
    }
  }

  async versions(context: TenantContext, id: string): Promise<FileVersions> {
    this.runtime.requireStorage();
    return createTenantRunner(this.identity.pool)(context, async (tx) => {
      const entry = await fileRepository.findEntry(tx, id, 'share');
      if (!entry || entry.state !== 'active' || entry.kind !== 'file')
        throw new NotFoundException();
      const versions = await fileRepository.versions(tx, id);
      return {
        items: versions.map((version) => fileVersionResponse(entry, version)),
      };
    });
  }

  async operation(
    context: TenantContext,
    id: string,
  ): Promise<FileOperationResponse> {
    this.runtime.requireStorage();
    const operation = await createTenantRunner(this.identity.pool)(
      context,
      (tx) => fileRepository.findOperation(tx, id),
    );
    if (!operation) throw new NotFoundException();
    return fileOperationResponse(operation);
  }
}
