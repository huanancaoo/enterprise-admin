import { Injectable } from '@nestjs/common';
import {
  type ApiErrorCode,
  type PlatformStoragePolicy,
  type PlatformStoragePolicyUpdateResult,
  type UpdatePlatformStoragePolicy,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';
import type { PlatformPrincipal } from './platform-access.service';

const statuses = {
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  FORBIDDEN: 403,
  PLATFORM_MFA_REQUIRED: 403,
  VALIDATION_ERROR: 400,
  AUDIT_UNAVAILABLE: 503,
  AUTHORIZATION_UNAVAILABLE: 503,
  IDEMPOTENCY_KEY_REUSED: 409,
} satisfies Partial<Record<ApiErrorCode, number>>;

@Injectable()
export class PlatformStoragePolicyService {
  constructor(private readonly runtime: AuthRuntime) {}

  get(
    actor: PlatformPrincipal,
    organizationId: string,
    requestId: string,
  ): Promise<PlatformStoragePolicy> {
    return this.execute(
      actor,
      organizationId,
      'get',
      requestId,
      'SELECT public.get_platform_storage_policy($1, $2, $3, $4) AS result',
      [actor.userId, actor.sessionId, organizationId, requestId],
    );
  }

  update(
    actor: PlatformPrincipal,
    organizationId: string,
    input: UpdatePlatformStoragePolicy,
    key: string,
    requestId: string,
  ): Promise<PlatformStoragePolicyUpdateResult> {
    return this.execute(
      actor,
      organizationId,
      'update',
      requestId,
      'SELECT public.update_platform_storage_policy($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS result',
      [
        actor.userId,
        actor.sessionId,
        organizationId,
        input.quotaBytes,
        input.trashDays,
        input.historyDays,
        input.reason,
        input.expectedVersion,
        key,
        requestId,
      ],
    );
  }

  private async execute<T>(
    actor: PlatformPrincipal,
    organizationId: string,
    action: 'get' | 'update',
    requestId: string,
    statement: string,
    parameters: unknown[],
  ): Promise<T> {
    try {
      const response = await this.runtime.pool.query<{ result: T }>(
        statement,
        parameters,
      );
      return response.rows[0].result;
    } catch (failure) {
      // 只投影本通道的业务错误；数据库异常文本不属于公开协议。
      const code =
        failure instanceof Error &&
        'code' in failure &&
        failure.code === 'P0001' &&
        Object.hasOwn(statuses, failure.message)
          ? (failure.message as keyof typeof statuses)
          : 'INTERNAL_ERROR';
      const status = code === 'INTERNAL_ERROR' ? 500 : statuses[code];
      if (status !== 400) {
        try {
          await this.runtime.pool.query(
            'SELECT public.record_platform_storage_policy_failure($1, $2, $3, $4, $5)',
            [actor.userId, organizationId, action, code, requestId],
          );
        } catch {
          throw new ApiException(503, 'AUDIT_UNAVAILABLE');
        }
      }
      throw new ApiException(status, code);
    }
  }
}
