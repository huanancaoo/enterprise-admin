import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  ApiErrorCodeSchema,
  PlatformAuditCursorSchema,
  type PlatformAuditCursor as Cursor,
  type ApiErrorCode,
  type PlatformAuditEvent,
  type PlatformAuditPage,
  type PlatformAuditQuery,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from './platform-access.service';

@Injectable()
export class PlatformAudit {
  constructor(private readonly runtime: AuthRuntime) {}

  async list(
    actor: PlatformPrincipal,
    query: PlatformAuditQuery,
    requestId: string,
  ): Promise<PlatformAuditPage> {
    const cursor = query.cursor ? this.readCursor(query.cursor) : undefined;
    const filters = cursor?.filters ?? {
      from: query.from ? new Date(query.from).toISOString() : undefined,
      to: query.to ? new Date(query.to).toISOString() : undefined,
      organizationId: query.organizationId,
      actorId: query.actorId,
      eventCode: query.eventCode,
      result: query.result,
      limit: query.limit ?? 20,
    };
    if (cursor) {
      for (const key of [
        'from',
        'to',
        'organizationId',
        'actorId',
        'eventCode',
        'result',
        'limit',
      ] as const) {
        const value = query[key];
        const normalized =
          key === 'from' || key === 'to'
            ? value === undefined
              ? undefined
              : new Date(value).toISOString()
            : value;
        const expected =
          key === 'from' || key === 'to'
            ? new Date(cursor.filters[key]).toISOString()
            : cursor.filters[key];
        if (normalized !== undefined && normalized !== expected)
          throw new ApiException(400, 'VALIDATION_ERROR');
      }
    }
    const result = await this.call<{
      items: PlatformAuditEvent[];
      next: Cursor['before'] | null;
      window: { from: string; to: string };
    }>(
      'SELECT public.list_platform_audit_events($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) AS result',
      [
        actor.userId,
        actor.sessionId,
        query.purpose,
        filters.from ?? null,
        filters.to ?? null,
        filters.organizationId ?? null,
        filters.actorId ?? null,
        filters.eventCode ?? null,
        filters.result ?? null,
        cursor?.before.occurredAt ?? null,
        cursor?.before.id ?? null,
        filters.limit,
        requestId,
      ],
    );
    return {
      items: result.items,
      nextCursor: result.next
        ? this.signCursor({
            audience: 'platform-audit',
            filters: { ...filters, ...result.window },
            before: result.next,
          })
        : null,
    };
  }

  get(
    actor: PlatformPrincipal,
    eventId: string,
    purpose: string,
    requestId: string,
  ): Promise<PlatformAuditEvent> {
    return this.call(
      'SELECT public.get_platform_audit_event($1,$2,$3,$4,$5) AS result',
      [actor.userId, actor.sessionId, eventId, purpose, requestId],
    );
  }

  private signCursor(cursor: Cursor): string {
    const payload = Buffer.from(
      JSON.stringify(PlatformAuditCursorSchema.parse(cursor)),
    ).toString('base64url');
    const signature = createHmac('sha256', this.runtime.auditCursorKey)
      .update(payload)
      .digest('base64url');
    return `${payload}.${signature}`;
  }

  private readCursor(encoded: string): Cursor {
    try {
      const [payload, signature, extra] = encoded.split('.');
      if (
        !payload ||
        !signature ||
        extra !== undefined ||
        !/^[A-Za-z0-9_-]{43}$/.test(signature)
      )
        throw new Error('Invalid cursor');
      const expected = createHmac('sha256', this.runtime.auditCursorKey)
        .update(payload)
        .digest();
      const actual = Buffer.from(signature, 'base64url');
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error('Invalid cursor');
      return PlatformAuditCursorSchema.parse(
        JSON.parse(Buffer.from(payload, 'base64url').toString()) as unknown,
      );
    } catch {
      throw new ApiException(400, 'VALIDATION_ERROR');
    }
  }

  private async call<T>(statement: string, values: unknown[]): Promise<T> {
    try {
      return (await this.runtime.pool.query<{ result: T }>(statement, values))
        .rows[0].result;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P0001') {
        const parsed = ApiErrorCodeSchema.safeParse(error.message);
        const statuses: Partial<Record<ApiErrorCode, number>> = {
          FORBIDDEN: 403,
          PLATFORM_MFA_REQUIRED: 403,
          NOT_FOUND: 404,
          VALIDATION_ERROR: 400,
          AUDIT_UNAVAILABLE: 503,
          AUTHORIZATION_UNAVAILABLE: 503,
        };
        if (parsed.success && statuses[parsed.data])
          throw new ApiException(statuses[parsed.data]!, parsed.data);
      }
      throw error;
    }
  }
}
