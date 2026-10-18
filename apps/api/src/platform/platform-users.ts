import { Injectable } from '@nestjs/common';
import {
  type ApiErrorCode,
  type PlatformUsersQuery,
  type PlatformUsersPage,
  type PlatformUserDetail,
  type PlatformSensitiveProfile,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import type { PlatformPrincipal } from './platform-access.service';
import { rethrowPlatformDatabaseError } from './platform-database-error';

@Injectable()
export class PlatformUsers {
  constructor(private readonly runtime: AuthRuntime) {}

  list(
    actor: PlatformPrincipal,
    query: PlatformUsersQuery,
    requestId: string,
  ): Promise<PlatformUsersPage> {
    return this.call(
      'SELECT public.list_platform_users($1,$2,$3,$4,$5,$6) AS result',
      [
        actor.userId,
        actor.sessionId,
        query.q ?? null,
        query.page,
        query.pageSize,
        requestId,
      ],
    );
  }

  get(
    actor: PlatformPrincipal,
    userId: string,
    requestId: string,
  ): Promise<PlatformUserDetail> {
    return this.call('SELECT public.get_platform_user($1,$2,$3,$4) AS result', [
      actor.userId,
      actor.sessionId,
      userId,
      requestId,
    ]);
  }

  sensitive(
    actor: PlatformPrincipal,
    userId: string,
    purpose: string,
    requestId: string,
  ): Promise<PlatformSensitiveProfile> {
    return this.call(
      'SELECT public.get_platform_sensitive_profile($1,$2,$3,$4,$5) AS result',
      [actor.userId, actor.sessionId, userId, purpose, requestId],
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
