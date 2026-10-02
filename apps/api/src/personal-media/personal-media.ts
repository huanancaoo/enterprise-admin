import {
  PersonalAvatarResultSchema,
  PersonalMediaUploadResultSchema,
  type PersonalMediaUploadResult,
  type SetPersonalAvatar,
} from '@workspace/contracts';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Identity } from '../identity/identity.service';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from '../files/files-runtime';
import { StorageError, type StoredRead } from '../files/storage/storage';
import { ApiException } from '../http/api-exception';
import { FileLease } from '../files/file-lease';
import {
  personalFailureCode,
  rethrowPersonalMediaError,
} from './personal-media-errors';
import { readImage } from './image-input';

type ImageInput = Awaited<ReturnType<typeof readImage>>;
interface StoredMedia {
  id: string;
  user_id: string;
  operation_id: string;
  bytes: number;
  sha256: string;
  content_type: ImageInput['contentType'];
  storage_path: string[];
  created_at: string;
  expires_at: string | null;
}
interface UploadOperation {
  id: string;
  media_id: string;
  phase: 'pending' | 'preparing' | 'completed' | 'failed';
  lease_expires_at: string;
  actual_bytes: number;
  actual_sha256: string;
  content_type: ImageInput['contentType'];
  completed_at: string;
}

export class PersonalMedia {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly files: FilesRuntime,
  ) {}

  private result(media: StoredMedia): PersonalMediaUploadResult {
    return PersonalMediaUploadResultSchema.parse({
      operationId: media.operation_id,
      result: 'succeeded',
      media: {
        id: media.id,
        bytes: media.bytes,
        contentType: media.content_type,
        contentUrl: `/api/v1/personal-media/${media.id}/content`,
        createdAt: media.created_at,
        expiresAt: media.expires_at,
      },
    });
  }

  async upload(
    identity: Identity,
    operationId: string,
    image: ImageInput,
    requestId: string,
    requestSignal: AbortSignal,
  ) {
    const storage = this.files.requireStorage();
    try {
      return await this.files.requirePhysicalScope().run(
        { kind: 'personal', id: identity.userId },
        async (scopeSignal) => {
          const signal = AbortSignal.any([scopeSignal, requestSignal]);
          signal.throwIfAborted();
          const candidate = await this.runtime.pool.query<{
            result: { operation: UploadOperation; reused: boolean };
          }>(
            'SELECT public.begin_personal_media_upload($1,$2,$3,$4,$5,$6) AS result',
            [
              identity.userId,
              identity.sessionId,
              operationId,
              image.sha256,
              image.bytes,
              requestId,
            ],
          );
          const { operation, reused } = candidate.rows[0].result;
          if (operation.phase === 'failed')
            throw new Error('PERSONAL_MEDIA_OPERATION_EXPIRED');
          if (operation.phase === 'completed') {
            // 同 key、同原字节只返回已发布事实，绝不能覆盖不可变媒体。
            const media = await this.runtime.pool.query<{ media: StoredMedia }>(
              'SELECT public.get_personal_media_content($1,$2,$3,NULL) AS media',
              [identity.userId, identity.sessionId, operation.media_id],
            );
            return this.result(media.rows[0].media);
          }
          // 未知结果的重放由维护流程核实；用户请求不能再次写入同一固定目标。
          if (reused) throw new ApiException(409, 'FILE_OPERATION_IN_PROGRESS');
          const leaseId = randomUUID();
          const claimStarted = performance.now();
          const claimed = await this.runtime.pool.query<{
            operation: UploadOperation | null;
            time: Date;
          }>(
            `WITH claimed AS MATERIALIZED (SELECT public.claim_personal_media_upload($1,$2,$3,$4) AS operation)
             SELECT operation, clock_timestamp() AS time FROM claimed`,
            [identity.userId, identity.sessionId, operationId, leaseId],
          );
          if (!claimed.rows[0].operation)
            throw new ApiException(409, 'FILE_OPERATION_IN_PROGRESS');
          const remaining = (expiry: string, time: Date) =>
            new Date(expiry).getTime() - time.getTime();
          const lease = new FileLease(
            remaining(
              claimed.rows[0].operation.lease_expires_at,
              claimed.rows[0].time,
            ) -
              (performance.now() - claimStarted),
            signal,
            async () => {
              const started = performance.now();
              const query = {
                text: `WITH renewed AS MATERIALIZED (SELECT public.renew_personal_media_upload($1,$2,$3,$4) AS operation)
                       SELECT operation, clock_timestamp() AS time FROM renewed`,
                values: [
                  identity.userId,
                  identity.sessionId,
                  operationId,
                  leaseId,
                ],
                query_timeout: 10_000,
              };
              const renewed = await this.runtime.pool.query<{
                operation: UploadOperation;
                time: Date;
              }>(query);
              return (
                remaining(
                  renewed.rows[0].operation.lease_expires_at,
                  renewed.rows[0].time,
                ) -
                (performance.now() - started)
              );
            },
          );
          const ioSignal = lease.signal;
          try {
            await storage.ensureOwner(
              { kind: 'personal', id: identity.userId },
              ioSignal,
            );
            const stored = await storage.write(
              {
                owner: { kind: 'personal', id: identity.userId },
                area: 'files',
                segments: [operation.media_id],
              },
              Readable.from([image.body]),
              image.bytes,
              ioSignal,
            );
            if (stored.bytes !== image.bytes || stored.sha256 !== image.sha256)
              throw new StorageError('STORAGE_CONTENT_MISMATCH');
            await lease.stop();
            ioSignal.throwIfAborted();
            const published = await this.runtime.pool.query<{
              media: StoredMedia;
            }>(
              'SELECT public.publish_personal_media_upload($1,$2,$3,$4,$5,$6,$7,$8) AS media',
              [
                identity.userId,
                identity.sessionId,
                operationId,
                leaseId,
                image.bytes,
                image.sha256,
                image.contentType,
                requestId,
              ],
            );
            return this.result(published.rows[0].media);
          } catch (error) {
            const failure: unknown = ioSignal.aborted ? ioSignal.reason : error;
            await lease.stop().catch(() => undefined);
            // 只移交原 token 的未发布计划。响应未知时 SQL 若已完成会拒绝移交，不能猜测并删除。
            try {
              await this.runtime.pool.query(
                'SELECT public.handoff_personal_media_upload_failure($1,$2,$3,$4)',
                [
                  identity.userId,
                  operationId,
                  leaseId,
                  personalFailureCode(failure),
                ],
              );
            } catch (handoffError) {
              if (!(
                handoffError instanceof Error &&
                handoffError.message === 'FILE_OPERATION_LEASE_CONFLICT'
              ))
                throw handoffError;
            }
            throw failure;
          }
        },
        requestSignal,
      );
    } catch (error) {
      rethrowPersonalMediaError(error);
    }
  }

  async setAvatar(
    identity: Identity,
    input: SetPersonalAvatar,
    requestId: string,
  ) {
    try {
      return await this.files
        .requirePhysicalScope()
        .run({ kind: 'personal', id: identity.userId }, async (signal) => {
          signal.throwIfAborted();
          const result = await this.runtime.pool.query<{ result: unknown }>(
            'SELECT public.set_personal_avatar($1,$2,$3,$4,$5,$6) AS result',
            [
              identity.userId,
              identity.sessionId,
              input.mediaId,
              input.expectedImage,
              input.idempotencyKey,
              requestId,
            ],
          );
          const context = await this.runtime.auth.$context;
          const user = await context.internalAdapter.findUserById(
            identity.userId,
          );
          if (!user) throw new ApiException(401, 'UNAUTHENTICATED');
          // 同一个 owner 锁串行头像保存与原生缓存刷新；只投影当前 User，不回写旧 image/updatedAt。
          // 收据重放也刷新缓存，使已提交而缓存确认失败的结果可以被用户明确恢复。
          await context.internalAdapter.refreshUserSessions(user);
          signal.throwIfAborted();
          return PersonalAvatarResultSchema.parse(result.rows[0].result);
        });
    } catch (error) {
      rethrowPersonalMediaError(error);
    }
  }

  async open(
    identity: Identity,
    mediaId: string,
    organizationId: string | undefined,
    signal: AbortSignal,
  ) {
    const storage = this.files.requireStorage();
    const client = await this.runtime.pool.connect();
    let read: StoredRead | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<{ media: StoredMedia }>(
        'SELECT public.get_personal_media_content($1,$2,$3,$4) AS media',
        [identity.userId, identity.sessionId, mediaId, organizationId ?? null],
      );
      const media = result.rows[0].media;
      // SQL 的媒体 share 锁保留至真实 open；过期清理不能在授权和取得对象之间抢删。
      read = await storage.open(
        {
          owner: { kind: 'personal', id: media.user_id },
          area: 'files',
          segments: media.storage_path,
        },
        undefined,
        signal,
      );
      if (
        read.bytes !== media.bytes ||
        read.totalBytes !== media.bytes ||
        read.range
      )
        throw new StorageError('STORAGE_RESPONSE_INVALID');
      await client.query('COMMIT');
      return { media, read };
    } catch (error) {
      read?.body.destroy();
      await client.query('ROLLBACK');
      rethrowPersonalMediaError(error);
    } finally {
      client.release();
    }
  }
}
