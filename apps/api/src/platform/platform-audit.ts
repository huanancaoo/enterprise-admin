import { Injectable } from '@nestjs/common';
import {
  ApiErrorCodeSchema,
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

  list(
    actor: PlatformPrincipal,
    query: PlatformAuditQuery,
    requestId: string,
  ): Promise<PlatformAuditPage> {
    return this.call(
      'SELECT public.list_platform_audit_events($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
      [
        actor.userId,
        actor.sessionId,
        // 保留数据库返回窗口的微秒精度；Date 会将边界截断到毫秒。
        query.from ?? null,
        query.to ?? null,
        query.organizationId ?? null,
        query.actorId ?? null,
        query.eventCode ?? null,
        query.result ?? null,
        query.page,
        query.pageSize,
        requestId,
      ],
    );
  }

  get(
    actor: PlatformPrincipal,
    eventId: string,
    requestId: string,
  ): Promise<PlatformAuditEvent> {
    return this.call(
      'SELECT public.get_platform_audit_event($1,$2,$3,$4) AS result',
      [actor.userId, actor.sessionId, eventId, requestId],
    );
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
