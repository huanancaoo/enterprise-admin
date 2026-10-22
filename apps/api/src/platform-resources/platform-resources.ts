import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  FilePathError,
  normalizeFileName,
} from '@workspace/contracts/file-path';
import type { PoolClient } from 'pg';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import {
  platformStorageOwner,
  StorageError,
  type StorageAddress,
} from '../files/storage/storage';
import { ApiException } from '../http/api-exception';
import type {
  OpenPlatformResource,
  PlatformResource,
  PlatformResourceActor,
  PlatformResourceInput,
  PlatformResourcePurpose,
} from './platform-resource';

const databaseErrors = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ACCOUNT_SUSPENDED: 403,
  AUTHORIZATION_UNAVAILABLE: 503,
  AUDIT_UNAVAILABLE: 503,
} as const;

function rethrowResourceError(error: unknown): never {
  if (error instanceof ApiException) throw error;
  if (error instanceof FilePathError)
    throw new ApiException(400, 'VALIDATION_ERROR');
  if (error instanceof StorageError) {
    if (error.code === 'STORAGE_NOT_FOUND')
      throw new ApiException(404, 'NOT_FOUND');
    if (
      error.code === 'STORAGE_LENGTH_MISMATCH' ||
      error.code === 'STORAGE_CONTENT_MISMATCH'
    )
      throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
    throw new ApiException(503, 'FILE_STORAGE_UNAVAILABLE');
  }
  if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'P0001' &&
    Object.hasOwn(databaseErrors, error.message)
  ) {
    const code = error.message as keyof typeof databaseErrors;
    throw new ApiException(databaseErrors[code], code);
  }
  throw new ApiException(500, 'INTERNAL_ERROR');
}

@Injectable()
export class PlatformResources {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly files: FilesRuntime,
  ) {}

  async create(
    actor: PlatformResourceActor,
    purpose: PlatformResourcePurpose,
    input: PlatformResourceInput,
    requestId: string,
  ): Promise<PlatformResource> {
    let name: string;
    try {
      name = normalizeFileName(input.name);
    } catch (error) {
      rethrowResourceError(error);
    }
    if (
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 0 ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(input.mimeType)
    )
      throw new ApiException(400, 'VALIDATION_ERROR');

    const storage = this.files.requireStorage();
    const id = randomUUID();
    const address = this.address(id);
    let written = false;
    let commitAttempted = false;
    let client: PoolClient | undefined;
    let failed = false;
    try {
      await this.runtime.pool.query(
        'SELECT public.prepare_platform_resource($1,$2,$3)',
        [actor.userId, actor.sessionId, purpose],
      );
      await storage.ensureOwner(platformStorageOwner);
      const facts = await storage.write(address, input.source, input.bytes);
      written = true;
      client = await this.runtime.pool.connect();
      await client.query('BEGIN');
      // 物理写入期间可能发生撤权；最终元数据和成功留痕必须按当前身份一起提交。
      const response = await client.query<{ result: PlatformResource }>(
        'SELECT public.create_platform_resource($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        [
          actor.userId,
          actor.sessionId,
          id,
          purpose,
          name,
          input.mimeType,
          facts.bytes,
          facts.sha256,
          requestId,
        ],
      );
      commitAttempted = true;
      await client.query('COMMIT');
      return response.rows[0].result;
    } catch (error) {
      failed = true;
      if (!commitAttempted) {
        try {
          try {
            if (client) await client.query('ROLLBACK');
          } finally {
            if (written) await storage.remove(address);
          }
        } catch (cleanupError) {
          return rethrowResourceError(cleanupError);
        }
      }
      // COMMIT 断连可能已提交，不能删除已有元数据引用的内容。
      return rethrowResourceError(error);
    } finally {
      client?.release(failed);
    }
  }

  async getForActor(
    actor: PlatformResourceActor,
    id: string,
    requestId: string,
  ): Promise<OpenPlatformResource> {
    try {
      const result = await this.runtime.pool.query<{
        result: PlatformResource;
      }>('SELECT public.get_platform_resource($1,$2,$3,$4) AS result', [
        actor.userId,
        actor.sessionId,
        id,
        requestId,
      ]);
      return await this.open(result.rows[0].result);
    } catch (error) {
      rethrowResourceError(error);
    }
  }

  // 仅供任务领域在完成自己的当前授权后调用；不能直接映射为按 ID 下载的 HTTP 路由。
  async openInternal(id: string): Promise<OpenPlatformResource> {
    try {
      const result = await this.runtime.pool.query<{
        result: PlatformResource;
      }>('SELECT public.get_platform_resource_internal($1) AS result', [id]);
      return await this.open(result.rows[0].result);
    } catch (error) {
      rethrowResourceError(error);
    }
  }

  private address(id: string): StorageAddress {
    return { owner: platformStorageOwner, area: 'files', segments: [id] };
  }

  private async open(
    resource: PlatformResource,
  ): Promise<OpenPlatformResource> {
    const read = await this.files
      .requireStorage()
      .open(this.address(resource.id));
    if (read.totalBytes !== resource.bytes) {
      read.body.destroy();
      throw new StorageError('STORAGE_CONTENT_MISMATCH');
    }
    return { resource, read };
  }
}
