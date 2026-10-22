import { Injectable, StreamableFile } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { create as contentDisposition } from 'content-disposition';
import type { Request, Response } from 'express';
import {
  ApiErrorCodeSchema,
  AnnouncementDeletedSchema,
  AnnouncementDetailSchema,
  AnnouncementInboxPageSchema,
  AnnouncementPageSchema,
  AnnouncementReadersPageSchema,
  AnnouncementReadingSchema,
  AnnouncementReadResultSchema,
} from '@workspace/contracts';
import { AnnouncementEditorDocumentSchema } from '@workspace/rich-text';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { announcementRepository } from '@workspace/database/repositories/announcements';
import { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from '../platform/platform-access.service';
import {
  PlatformFiles,
  PlatformFileMediaSchema,
} from '../platform-files/platform-files';
import { ApiException } from '../http/api-exception';
import { readAnnouncementUpload } from './announcement-upload';

type Actor = Pick<PlatformPrincipal, 'userId' | 'sessionId'>;
const mediaResult = PlatformFileMediaSchema;

export function announcementError(error: unknown): never {
  // TenantRunner 的 Drizzle 查询把 PostgreSQL 异常放在 cause；业务码只认 P0001。
  const failure =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  if (
    failure instanceof Error &&
    'code' in failure &&
    failure.code === 'P0001'
  ) {
    const code = ApiErrorCodeSchema.safeParse(failure.message);
    if (code.success) {
      const status =
        code.data === 'NOT_FOUND'
          ? 404
          : code.data === 'FORBIDDEN' ||
              code.data === 'ACCOUNT_SUSPENDED' ||
              code.data === 'ORGANIZATION_SUSPENDED'
            ? 403
            : code.data === 'UNAUTHENTICATED'
              ? 401
              : code.data === 'VALIDATION_ERROR'
                ? 400
                : code.data === 'VERSION_CONFLICT' ||
                    code.data === 'ANNOUNCEMENT_STATE_CONFLICT'
                  ? 409
                  : 503;
      throw new ApiException(status, code.data);
    }
  }
  throw error;
}

function inboxResult(operation: string, value: unknown) {
  if (operation === 'list') return AnnouncementInboxPageSchema.parse(value);
  if (operation === 'read') return AnnouncementReadResultSchema.parse(value);
  if (operation === 'media') return mediaResult.parse(value);
  return AnnouncementReadingSchema.parse(value);
}

@Injectable()
export class Announcements {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly files: PlatformFiles,
  ) {}

  async manage(
    actor: Actor,
    operation: string,
    id: string | null,
    input: Record<string, unknown>,
    requestId: string,
  ) {
    if (operation === 'create' || operation === 'update') {
      const document = AnnouncementEditorDocumentSchema.safeParse(
        input.content,
      );
      if (!document.success) throw new ApiException(400, 'VALIDATION_ERROR');
    }
    try {
      const result = await this.runtime.pool.query<{ result: unknown }>(
        'SELECT public.platform_announcement_command($1,$2,$3,$4,$5::jsonb,$6) AS result',
        [
          actor.userId,
          actor.sessionId,
          operation,
          id,
          JSON.stringify(input),
          requestId,
        ],
      );
      const value = result.rows[0].result;
      if (operation === 'list' || operation === 'export-page')
        return AnnouncementPageSchema.parse(value);
      if (operation === 'readers')
        return AnnouncementReadersPageSchema.parse(value);
      if (operation === 'delete') return AnnouncementDeletedSchema.parse(value);
      if (operation === 'media') return mediaResult.parse(value);
      return AnnouncementDetailSchema.parse(value);
    } catch (error) {
      announcementError(error);
    }
  }

  async inbox(
    actor: Actor,
    organizationId: string | null,
    operation: string,
    id: string | null,
    input: Record<string, unknown>,
    requestId: string,
  ) {
    try {
      const result = await this.runtime.pool.query<{ result: unknown }>(
        'SELECT public.platform_announcement_inbox($1,$2,$3,$4,$5,$6::jsonb,$7) AS result',
        [
          actor.userId,
          actor.sessionId,
          organizationId,
          operation,
          id,
          JSON.stringify(input),
          requestId,
        ],
      );
      return inboxResult(operation, result.rows[0].result);
    } catch (error) {
      announcementError(error);
    }
  }

  async tenantInbox(
    context: TenantContext,
    operation: string,
    id: string | null,
    input: Record<string, unknown>,
  ) {
    try {
      const result = await createTenantRunner(this.runtime.pool)(
        context,
        (tx) => announcementRepository.inbox(tx, operation, id, input),
        operation === 'read' ? 'write' : 'read',
      );
      return inboxResult(operation, result);
    } catch (error) {
      announcementError(error);
    }
  }

  async upload(actor: Actor, request: Request, requestId: string) {
    const input = await readAnnouncementUpload(request);
    try {
      return await this.files.uploadAnnouncement(actor, input, requestId);
    } finally {
      input.source.destroy();
      await input.dispose();
    }
  }

  async media(
    actor: Actor,
    organizationId: string | null,
    id: string,
    versionId: string,
    response: Response,
    management = false,
  ) {
    const requestId = response.locals.requestId as string;
    return this.stream(response, () =>
      management
        ? this.manage(actor, 'media', id, { versionId }, requestId)
        : this.inbox(
            actor,
            organizationId,
            'media',
            id,
            { versionId },
            requestId,
          ),
    );
  }

  async tenantMedia(
    context: TenantContext,
    id: string,
    versionId: string,
    response: Response,
  ) {
    return this.stream(response, () =>
      this.tenantInbox(context, 'media', id, { versionId }),
    );
  }

  private async stream(response: Response, authorize: () => Promise<unknown>) {
    const { resource, read } = await this.files.openReference(authorize);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const body = Readable.from(
      (async function* () {
        const hash = createHash('sha256');
        let bytes = 0;
        for await (const chunk of read.body) {
          const data = Buffer.from(chunk as Uint8Array);
          bytes += data.length;
          if (bytes > resource.bytes)
            throw new Error('RESOURCE_CONTENT_MISMATCH');
          hash.update(data);
          yield data;
        }
        if (bytes !== resource.bytes || hash.digest('hex') !== resource.sha256)
          throw new Error('RESOURCE_CONTENT_MISMATCH');
      })(),
    );
    const close = () => {
      body.destroy();
      read.body.destroy();
    };
    response.once('close', close);
    body.once('close', () => {
      response.removeListener('close', close);
      read.body.destroy();
    });
    return new StreamableFile(body, {
      type: resource.mimeType,
      length: resource.bytes,
      disposition: contentDisposition(resource.name, {
        type: resource.mimeType.startsWith('image/') ? 'inline' : 'attachment',
      }),
    }).setErrorHandler(() => {
      response.destroy();
      close();
    });
  }
}
