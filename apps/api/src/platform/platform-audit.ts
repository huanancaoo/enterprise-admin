import { Injectable } from '@nestjs/common';
import {
  type ApiErrorCode,
  type PlatformExportFilters,
  type PlatformAuditEvent,
  type PlatformAuditPage,
  type PlatformAuditQuery,
} from '@workspace/contracts';
import type { PoolClient } from 'pg';
import type { Identity } from '../identity/identity.service';
import { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from './platform-access.service';
import { rethrowPlatformDatabaseError } from './platform-database-error';

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
      this.listParameters(actor, query, requestId),
    );
  }

  async exportPage(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page?: number; pageSize?: number },
    requestId: string,
    client: PoolClient,
  ): Promise<PlatformAuditPage> {
    // 导出使用独立动作且沿用任务持锁连接；错误交回任务决定重试与结算。
    return (
      await client.query<{ result: PlatformAuditPage }>(
        'SELECT public.export_platform_audit_events_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        this.listParameters(
          actor,
          { ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 100 },
          requestId,
        ),
      )
    ).rows[0]?.result;
  }

  private listParameters(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page: number; pageSize: number },
    requestId: string,
  ): unknown[] {
    return [
      actor.userId,
      actor.sessionId,
      // 读取与导出共用数据库窗口的原始微秒精度，不能经 Date 截断。
      query.from ?? null,
      query.to ?? null,
      query.organizationId ?? null,
      query.actorId ?? null,
      query.eventCode ?? null,
      query.result ?? null,
      query.page,
      query.pageSize,
      requestId,
    ];
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
      const statuses: Partial<Record<ApiErrorCode, number>> = {
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        VALIDATION_ERROR: 400,
        AUDIT_UNAVAILABLE: 503,
        AUTHORIZATION_UNAVAILABLE: 503,
      };
      rethrowPlatformDatabaseError(error, statuses);
    }
  }
}
