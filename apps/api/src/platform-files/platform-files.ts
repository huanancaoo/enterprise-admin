import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  ApiErrorCodeSchema,
  FileOperationResponseSchema,
  PlatformFileWorkspaceSchema,
  PlatformFilePageSchema,
  PlatformFileBreadcrumbsSchema,
  PlatformFileEntrySchema,
  UploadFileFieldsSchema,
  FileVersionsSchema,
  FileVersionResponseSchema,
  FileUsageResponseSchema,
  FileEntryImpactSchema,
  PlatformFileReferencesSchema,
  FileBatchResponseSchema,
  type ExecuteFileBatch,
  type UpdatePlatformFilePolicy,
  type CreateFolder,
  type FileListQuery,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import {
  platformFileStorageOwner,
  StorageError,
  verifyContent,
  type StoredRead,
} from '../files/storage/storage';
import type { PlatformPrincipal } from '../platform/platform-access.service';
import { ApiException } from '../http/api-exception';
import { PlatformFileExecutor } from './platform-file-executor';
import type {
  OrganizationFileUpload,
  OrganizationFileOverwrite,
} from '../files/file-upload-stream';
import { contentDisposition, requestedRange } from '../files/file-content';

export type PlatformFileActor = Pick<PlatformPrincipal, 'userId' | 'sessionId'>;

export const PlatformFileMediaSchema = z.object({
  resource: z.object({
    id: z.uuid(),
    versionId: z.uuid(),
    name: z.string(),
    mimeType: z.string(),
    bytes: z.number(),
    sha256: z.string(),
  }),
  area: z.enum(['files', 'history', 'trash']),
  path: z.array(z.string()),
});

@Injectable()
export class PlatformFiles implements OnModuleInit, OnApplicationShutdown {
  private readonly executor: PlatformFileExecutor;
  private readonly logger = new Logger(PlatformFiles.name);
  private timer?: NodeJS.Timeout;
  private maintenance?: Promise<void>;
  private readonly shutdown = new AbortController();
  constructor(
    private readonly identity: AuthRuntime,
    private readonly files: FilesRuntime,
  ) {
    this.executor = new PlatformFileExecutor(identity.pool, files);
  }
  async onModuleInit() {
    if (!this.files.enabled) return;
    const run = () => {
      if (!this.maintenance)
        this.maintenance = this.executor
          .maintain(this.shutdown.signal)
          .catch((error) => {
            if (!this.shutdown.signal.aborted) this.logger.error(error);
          })
          .finally(() => {
            this.maintenance = undefined;
          });
    };
    await this.executor.recover(this.shutdown.signal);
    this.timer = setInterval(run, 30000);
    this.timer.unref();
  }
  async onApplicationShutdown() {
    clearInterval(this.timer);
    this.shutdown.abort();
    await this.maintenance;
  }

  maintain() {
    return this.executor.maintain(this.shutdown.signal);
  }

  private async query<T>(
    sql: string,
    args: unknown[],
    schema: z.ZodType<T>,
    client = this.identity.pool as Pick<PoolClient, 'query'>,
  ): Promise<T> {
    try {
      const result = await client.query<{ result: unknown }>(sql, args);
      return schema.parse(result.rows[0].result);
    } catch (error) {
      throw this.failure(error);
    }
  }

  private failure(error: unknown): unknown {
    if (error instanceof Error && 'code' in error && error.code === 'P0001') {
      const code = ApiErrorCodeSchema.safeParse(error.message);
      if (code.success) {
        const status = ['FORBIDDEN', 'ACCOUNT_SUSPENDED'].includes(code.data)
          ? 403
          : code.data === 'UNAUTHENTICATED'
            ? 401
            : code.data === 'NOT_FOUND'
              ? 404
              : [
                    'VALIDATION_ERROR',
                    'FILE_NAME_TOO_LONG',
                    'FILE_PATH_TOO_LONG',
                  ].includes(code.data)
                ? 400
                : ['AUDIT_UNAVAILABLE', 'AUTHORIZATION_UNAVAILABLE'].includes(
                      code.data,
                    )
                  ? 503
                  : 409;
        return new ApiException(status, code.data);
      }
    }
    if (error instanceof StorageError) {
      if (
        error.code === 'STORAGE_CONTENT_MISMATCH' ||
        error.code === 'STORAGE_LENGTH_MISMATCH'
      )
        return new ApiException(409, 'FILE_CONTENT_MISMATCH');
      if (error.code === 'STORAGE_NOT_FOUND')
        return new ApiException(404, 'NOT_FOUND');
      return new ApiException(503, 'FILE_STORAGE_UNAVAILABLE');
    }
    return error;
  }

  async workspace(actor: PlatformFileActor, requestId: string) {
    this.files.requireStorage();
    return this.query(
      'SELECT public.platform_file_workspace($1,$2,$3) AS result',
      [actor.userId, actor.sessionId, requestId],
      PlatformFileWorkspaceSchema,
    );
  }
  private read<T>(
    actor: PlatformFileActor,
    kind: string,
    id: string | null,
    input: unknown,
    schema: z.ZodType<T>,
  ) {
    this.files.requireStorage();
    return this.query(
      'SELECT public.platform_file_read($1,$2,$3,$4,$5) AS result',
      [actor.userId, actor.sessionId, kind, id, input],
      schema,
    );
  }
  list(actor: PlatformFileActor, input: FileListQuery) {
    return this.read(actor, 'list', null, input, PlatformFilePageSchema);
  }
  breadcrumbs(actor: PlatformFileActor, id: string) {
    return this.read(
      actor,
      'breadcrumbs',
      id,
      {},
      PlatformFileBreadcrumbsSchema,
    );
  }
  get(actor: PlatformFileActor, id: string) {
    return this.read(actor, 'get', id, {}, PlatformFileEntrySchema);
  }
  operation(actor: PlatformFileActor, id: string) {
    return this.read(actor, 'operation', id, {}, FileOperationResponseSchema);
  }

  createFolder(
    actor: PlatformFileActor,
    input: CreateFolder,
    requestId: string,
  ) {
    return this.execute(actor, 'create-folder', input, requestId);
  }
  async execute(
    actor: PlatformFileActor,
    action: string,
    input: { operationId: string; [key: string]: unknown },
    requestId: string,
    upload?: OrganizationFileUpload | OrganizationFileOverwrite,
  ) {
    try {
      return await this.executor.execute(
        actor,
        action,
        input,
        requestId,
        upload,
      );
    } catch (error) {
      throw this.failure(error);
    }
  }
  upload(
    actor: PlatformFileActor,
    upload: OrganizationFileUpload,
    requestId: string,
  ) {
    return this.execute(
      actor,
      'upload',
      { ...upload.fields, contentType: upload.contentType },
      requestId,
      upload,
    );
  }
  overwrite(
    actor: PlatformFileActor,
    id: string,
    upload: OrganizationFileOverwrite,
    requestId: string,
  ) {
    return this.execute(
      actor,
      'overwrite',
      { ...upload.fields, entryId: id, contentType: upload.contentType },
      requestId,
      upload,
    );
  }
  versions(actor: PlatformFileActor, id: string) {
    return this.read(actor, 'versions', id, {}, FileVersionsSchema);
  }
  policy(
    actor: PlatformFileActor,
    input: UpdatePlatformFilePolicy | null,
    requestId: string,
  ) {
    return this.query(
      'SELECT public.platform_file_policy_command($1,$2,$3,$4) AS result',
      [actor.userId, actor.sessionId, input, requestId],
      FileUsageResponseSchema,
    );
  }
  impact(actor: PlatformFileActor, id: string, action: string) {
    return this.query(
      'SELECT public.platform_file_impact($1,$2,$3,$4) AS result',
      [actor.userId, actor.sessionId, id, action],
      FileEntryImpactSchema,
    );
  }
  references(actor: PlatformFileActor, id: string) {
    return this.query(
      'SELECT public.platform_file_references_read($1,$2,$3) AS result',
      [actor.userId, actor.sessionId, id],
      PlatformFileReferencesSchema,
    );
  }
  private batchCommand(
    actor: PlatformFileActor,
    id: string,
    mode: string,
    input: unknown,
  ) {
    return this.query(
      'SELECT public.platform_file_batch($1,$2,$3,$4,$5) AS result',
      [actor.userId, actor.sessionId, id, mode, input],
      FileBatchResponseSchema,
    );
  }
  batch(actor: PlatformFileActor, id: string) {
    return this.batchCommand(actor, id, 'read', {});
  }
  async executeBatch(
    actor: PlatformFileActor,
    input: ExecuteFileBatch,
    requestId: string,
  ) {
    const batch = await this.batchCommand(
      actor,
      input.batchId,
      'create',
      input,
    );
    for (const item of batch.items) {
      if (
        item.index !== item.rootIndex ||
        item.state === 'completed' ||
        item.state === 'failed'
      )
        continue;
      try {
        const entry = input.items[item.index];
        await this.execute(
          actor,
          input.action,
          {
            ...entry,
            ...('parentId' in input && input.parentId
              ? { parentId: input.parentId }
              : {}),
          },
          requestId,
        );
      } catch (error) {
        if (!(error instanceof ApiException)) throw error;
        await this.batchCommand(actor, input.batchId, 'record', {
          index: item.index,
          error: {
            code: (error.getResponse() as { code: string }).code,
            ...(error.details ? { details: error.details } : {}),
          },
        });
      }
    }
    return this.batch(actor, input.batchId);
  }
  async uploadAnnouncement(
    actor: PlatformFileActor,
    input: {
      name: string;
      mimeType: string;
      bytes: number;
      sha256: string;
      source: Readable;
    },
    requestId: string,
  ) {
    const fields = UploadFileFieldsSchema.parse({
      operationId: randomUUID(),
      parentId: '00000000-0000-4000-8000-000000000002',
      name: input.name,
      declaredBytes: input.bytes,
      contentSha256: input.sha256,
    });
    const upload: OrganizationFileUpload = {
      fields,
      contentType: input.mimeType,
      signal: new AbortController().signal,
      writeTo: (storage, address, signal) =>
        storage.write(address, input.source, input.bytes, signal),
      verifyReplay: () =>
        verifyContent(
          { body: input.source, bytes: input.bytes, totalBytes: input.bytes },
          { bytes: input.bytes, sha256: input.sha256 },
        ),
    };
    // 公告每次上传都创建独立资源；同名由持有平台物理锁的准备事务分配序号。
    const operation = await this.execute(
      actor,
      'upload',
      { ...fields, contentType: input.mimeType, automaticName: true },
      requestId,
      upload,
    );
    if (operation.phase !== 'completed' || !operation.result?.versionId)
      throw new ApiException(503, 'FILE_STORAGE_UNAVAILABLE');
    return {
      fileId: operation.result.entryId,
      versionId: operation.result.versionId,
      name: fields.name,
      mimeType: input.mimeType,
      byteSize: input.bytes,
    };
  }
  async openReference(authorize: () => Promise<unknown>) {
    return this.files
      .requirePhysicalScope()
      .run(platformFileStorageOwner, async (signal) => {
        const item = PlatformFileMediaSchema.parse(await authorize());
        const read = await this.files.requireStorage().open(
          {
            owner: platformFileStorageOwner,
            area: item.area,
            segments: item.path,
          },
          undefined,
          signal,
        );
        return { resource: item.resource, read };
      });
  }
  async content(
    actor: PlatformFileActor,
    id: string,
    versionId: string,
    rangeHeader: string | undefined,
    disposition: 'inline' | 'attachment',
  ) {
    const client = await this.identity.pool.connect();
    let read: StoredRead | undefined;
    try {
      await client.query('BEGIN');
      const item = await this.query(
        'SELECT public.platform_file_read($1,$2,$3,$4,$5) AS result',
        [actor.userId, actor.sessionId, 'content', id, { versionId }],
        z.object({
          entry: PlatformFileEntrySchema,
          version: FileVersionResponseSchema,
          area: z.enum(['files', 'history', 'trash']),
          path: z.array(z.string()),
        }),
        client,
      );
      const range = requestedRange(rangeHeader, item.version.bytes);
      const dispositionHeader = contentDisposition(
        item.entry.name,
        item.version.contentType,
        disposition,
      );
      read = await this.files.requireStorage().open(
        {
          owner: platformFileStorageOwner,
          area: item.area,
          segments: item.path,
        },
        range,
      );
      if (
        read.totalBytes !== item.version.bytes ||
        read.bytes !==
          (range ? range.end - range.start + 1 : item.version.bytes)
      )
        throw new StorageError('STORAGE_RESPONSE_INVALID');
      await client.query('COMMIT');
      return { version: item.version, read, dispositionHeader };
    } catch (error) {
      read?.body.destroy();
      await client.query('ROLLBACK');
      throw this.failure(error);
    } finally {
      client.release();
    }
  }
}
