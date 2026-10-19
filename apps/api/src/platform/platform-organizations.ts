import { Injectable } from '@nestjs/common';
import {
  type ApiErrorCode,
  type PlatformExportFilters,
  type OrganizationTransitionResult,
  type TransitionOrganization,
  type PlatformOrganizationDetail,
  type PlatformOrganizationQuery,
  type PlatformOrganizationPage,
} from '@workspace/contracts';
import type { PoolClient } from 'pg';
import type { Identity } from '../identity/identity.service';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';
import type { PlatformPrincipal } from './platform-access.service';
import { rethrowPlatformDatabaseError } from './platform-database-error';

@Injectable()
export class PlatformOrganizations {
  constructor(private readonly runtime: AuthRuntime) {}

  async list(
    actor: PlatformPrincipal,
    query: PlatformOrganizationQuery,
    requestId: string,
  ): Promise<PlatformOrganizationPage> {
    return this.execute(
      actor,
      null,
      'list',
      requestId,
      'SELECT public.list_platform_organizations($1, $2, $3, $4, $5, $6, $7, $8, $9) AS result',
      this.listParameters(actor, query, requestId),
    );
  }

  async exportPage(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page?: number; pageSize?: number },
    requestId: string,
    client: PoolClient,
  ): Promise<PlatformOrganizationPage> {
    // 导出失败属于任务结算，不能额外记录普通组织读取失败；连接仍由任务持锁。
    return (
      await client.query<{ result: PlatformOrganizationPage }>(
        'SELECT public.export_platform_organizations_page($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
        this.listParameters(
          actor,
          {
            ...query,
            page: query.page ?? 1,
            pageSize: query.pageSize ?? 100,
            sortBy: query.sortBy ?? 'createdAt',
            sortOrder: query.sortOrder ?? 'desc',
          },
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
      query.q ?? null,
      query.status ?? null,
      query.page,
      query.pageSize,
      query.sortBy,
      query.sortOrder,
      requestId,
    ];
  }

  async get(
    actor: PlatformPrincipal,
    organizationId: string,
    requestId: string,
  ): Promise<PlatformOrganizationDetail> {
    return this.execute(
      actor,
      organizationId,
      'get',
      requestId,
      'SELECT public.get_platform_organization($1, $2, $3, $4) AS result',
      [actor.userId, actor.sessionId, organizationId, requestId],
    );
  }

  async transition(
    actor: PlatformPrincipal,
    organizationId: string,
    action: 'suspend' | 'resume',
    input: TransitionOrganization,
    key: string,
    requestId: string,
  ): Promise<OrganizationTransitionResult> {
    return this.execute(
      actor,
      organizationId,
      action,
      requestId,
      'SELECT public.transition_platform_organization($1, $2, $3, $4, $5, $6, $7, $8) AS result',
      [
        actor.userId,
        actor.sessionId,
        organizationId,
        action,
        input.reason,
        input.expectedVersion,
        key,
        requestId,
      ],
    );
  }

  private async execute<T>(
    actor: PlatformPrincipal,
    organizationId: string | null,
    action: 'list' | 'get' | 'suspend' | 'resume',
    requestId: string,
    statement: string,
    parameters: unknown[],
  ): Promise<T> {
    try {
      return await this.call<T>(statement, parameters);
    } catch (error) {
      if (!(error instanceof ApiException) || error.getStatus() !== 400) {
        const code =
          error instanceof ApiException
            ? (error.getResponse() as { code: ApiErrorCode }).code
            : 'INTERNAL_ERROR';
        try {
          await this.runtime.pool.query(
            'SELECT public.record_platform_organization_failure($1, $2, $3, $4, $5)',
            [actor.userId, organizationId, action, code, requestId],
          );
        } catch {
          throw new ApiException(503, 'AUDIT_UNAVAILABLE');
        }
      }
      throw error;
    }
  }

  private async call<T>(statement: string, parameters: unknown[]): Promise<T> {
    try {
      const response = await this.runtime.pool.query<{ result: T }>(
        statement,
        parameters,
      );
      return response.rows[0].result;
    } catch (error) {
      const statuses: Partial<Record<ApiErrorCode, number>> = {
        NOT_FOUND: 404,
        VERSION_CONFLICT: 409,
        FORBIDDEN: 403,
        VALIDATION_ERROR: 400,
        AUDIT_UNAVAILABLE: 503,
        AUTHORIZATION_UNAVAILABLE: 503,
        IDEMPOTENCY_KEY_REUSED: 409,
      };
      rethrowPlatformDatabaseError(error, statuses);
    }
  }
}
