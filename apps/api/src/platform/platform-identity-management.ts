import { Inject, Injectable } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import type { PoolClient } from 'pg';
import {
  type ApiErrorCode,
  type PlatformExportFilters,
  type CreatePlatformUser,
  type UpdatePlatformUser,
  type SetPlatformUserStatus,
  type PlatformUserDetail,
  type PlatformUserMutationResult,
  type LoginLogsQuery,
  type PersonalLoginLogsQuery,
  type LoginLogsPage,
  type PlatformLoginLogsPage,
  type PlatformSessionsQuery,
  type PlatformSessionsPage,
  type SessionRevokeResult,
  type PasswordLoginUnlockResult,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import type { Identity } from '../identity/identity.service';
import { ApiException } from '../http/api-exception';
import type { PlatformPrincipal } from './platform-access.service';
import { rethrowPlatformDatabaseError } from './platform-database-error';

export const PLATFORM_PASSWORD_RESET_REDIRECT = Symbol(
  'platformPasswordResetRedirect',
);

@Injectable()
export class PlatformIdentityManagement {
  constructor(
    private readonly runtime: AuthRuntime,
    @Inject(PLATFORM_PASSWORD_RESET_REDIRECT)
    private readonly passwordResetRedirect: string,
  ) {}

  async create(
    actor: PlatformPrincipal,
    input: CreatePlatformUser,
    requestId: string,
  ): Promise<PlatformUserDetail> {
    return this.mutate(
      actor,
      'platform.user_created',
      null,
      requestId,
      async () => {
        const hash = await hashPassword(input.password);
        return this.call(
          'SELECT public.create_platform_user($1,$2,$3,$4,$5,$6) AS result',
          [
            actor.userId,
            actor.sessionId,
            input.name,
            input.email,
            hash,
            requestId,
          ],
        );
      },
    );
  }

  update(
    actor: PlatformPrincipal,
    userId: string,
    input: UpdatePlatformUser,
    requestId: string,
  ): Promise<PlatformUserMutationResult> {
    return this.mutate(actor, 'platform.user_updated', userId, requestId, () =>
      this.call(
        'SELECT public.update_platform_user($1,$2,$3,$4,$5,$6) AS result',
        [
          actor.userId,
          actor.sessionId,
          userId,
          input.name,
          input.expectedVersion,
          requestId,
        ],
      ),
    );
  }

  setStatus(
    actor: PlatformPrincipal,
    userId: string,
    input: SetPlatformUserStatus,
    requestId: string,
  ): Promise<PlatformUserMutationResult> {
    const event =
      input.status === 'suspended'
        ? 'platform.user_suspended'
        : 'platform.user_resumed';
    return this.mutate(actor, event, userId, requestId, () =>
      this.transaction(async (client) => {
        const result = await this.call<PlatformUserMutationResult>(
          'SELECT public.set_platform_user_status($1,$2,$3,$4,$5,$6) AS result',
          [
            actor.userId,
            actor.sessionId,
            userId,
            input.status,
            input.expectedVersion,
            requestId,
          ],
          client,
        );
        if (input.status === 'suspended') {
          // 状态锁持续到原生清理结束，恢复后的新会话不能被旧暂停请求删除。
          const context = await this.runtime.auth.$context;
          await context.internalAdapter.deleteUserSessions(userId);
        }
        return result;
      }),
    );
  }

  requestPasswordReset(
    actor: PlatformPrincipal,
    userId: string,
    requestId: string,
  ): Promise<{ requested: true }> {
    return this.mutate(
      actor,
      'platform.user_password_reset_requested',
      userId,
      requestId,
      () =>
        this.transaction(async (client) => {
          // 令牌、邮件入队和审计共同提交，审计失败不能留下可投递的重置邮件。
          const target = await this.call<{ userId: string; email: string }>(
            'SELECT public.prepare_platform_password_reset($1,$2,$3,$4) AS result',
            [actor.userId, actor.sessionId, userId, requestId],
            client,
          );
          await this.runtime.auth.api.requestPasswordReset({
            body: {
              email: target.email,
              redirectTo: this.passwordResetRedirect,
            },
          });
          await this.call(
            'SELECT public.record_platform_password_reset_requested($1,$2,$3,$4) AS result',
            [actor.userId, actor.sessionId, userId, requestId],
            client,
          );
          return { requested: true };
        }),
    );
  }

  unlockPasswordLogin(
    actor: PlatformPrincipal,
    userId: string,
    requestId: string,
  ): Promise<PasswordLoginUnlockResult> {
    return this.mutate(
      actor,
      'platform.user_password_login_unlocked',
      userId,
      requestId,
      () =>
        this.call(
          'SELECT public.unlock_platform_password_login($1,$2,$3,$4) AS result',
          [actor.userId, actor.sessionId, userId, requestId],
        ),
    );
  }

  loginEvents(
    actor: PlatformPrincipal,
    query: LoginLogsQuery,
    requestId: string,
  ): Promise<PlatformLoginLogsPage> {
    return this.call(
      'SELECT public.list_platform_login_logs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
      this.loginEventsParameters(actor, query, requestId),
    );
  }

  async exportLoginEventsPage(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page?: number; pageSize?: number },
    requestId: string,
    client: PoolClient,
  ): Promise<PlatformLoginLogsPage> {
    // 导出使用独立动作且沿用任务持锁连接；错误交回任务决定重试与结算。
    return (
      await client.query<{ result: PlatformLoginLogsPage }>(
        'SELECT public.export_platform_login_logs_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS result',
        this.loginEventsParameters(
          actor,
          { ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 100 },
          requestId,
        ),
      )
    ).rows[0]?.result;
  }

  private loginEventsParameters(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page: number; pageSize: number },
    requestId: string,
  ): unknown[] {
    return [
      actor.userId,
      actor.sessionId,
      query.q ?? null,
      query.userId ?? null,
      query.result ?? null,
      query.method ?? null,
      query.from ?? null,
      query.to ?? null,
      query.page,
      query.pageSize,
      requestId,
    ];
  }

  personalLoginEvents(
    actor: Identity,
    query: PersonalLoginLogsQuery,
    requestId: string,
  ): Promise<LoginLogsPage> {
    return this.call(
      'SELECT public.list_personal_login_logs($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',
      [
        actor.userId,
        actor.sessionId,
        query.result ?? null,
        query.method ?? null,
        query.from ?? null,
        query.to ?? null,
        query.page,
        query.pageSize,
        requestId,
      ],
    );
  }

  sessions(
    actor: PlatformPrincipal,
    query: PlatformSessionsQuery,
    requestId: string,
  ): Promise<PlatformSessionsPage> {
    return this.call(
      'SELECT public.list_platform_sessions($1,$2,$3,$4,$5,$6,$7) AS result',
      this.sessionsParameters(actor, query, requestId),
    );
  }

  async exportSessionsPage(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page?: number; pageSize?: number },
    requestId: string,
    client: PoolClient,
  ): Promise<PlatformSessionsPage> {
    // 导出使用独立动作且沿用任务持锁连接；错误交回任务决定重试与结算。
    return (
      await client.query<{ result: PlatformSessionsPage }>(
        'SELECT public.export_platform_sessions_page($1,$2,$3,$4,$5,$6,$7) AS result',
        this.sessionsParameters(
          actor,
          { ...query, page: query.page ?? 1, pageSize: query.pageSize ?? 100 },
          requestId,
        ),
      )
    ).rows[0]?.result;
  }

  private sessionsParameters(
    actor: Pick<Identity, 'userId' | 'sessionId'>,
    query: PlatformExportFilters & { page: number; pageSize: number },
    requestId: string,
  ): unknown[] {
    return [
      actor.userId,
      actor.sessionId,
      query.q ?? null,
      query.userId ?? null,
      query.page,
      query.pageSize,
      requestId,
    ];
  }

  revokeSession(
    actor: PlatformPrincipal,
    sessionId: string,
    requestId: string,
  ): Promise<SessionRevokeResult> {
    return this.mutate(
      actor,
      'platform.session_revoked',
      sessionId,
      requestId,
      () =>
        this.transaction(async (client) => {
          // Token 仅用于服务端原生缓存撤销；外部接口只接受 Session ID。
          const target = await client.query<{ token: string }>(
            'SELECT token FROM public.session WHERE id=$1',
            [sessionId],
          );
          const result = await this.call<SessionRevokeResult>(
            'SELECT public.revoke_platform_session($1,$2,$3,$4) AS result',
            [actor.userId, actor.sessionId, sessionId, requestId],
            client,
          );
          if (target.rows[0]) {
            const context = await this.runtime.auth.$context;
            await context.internalAdapter.deleteSession(target.rows[0].token);
          }
          return result;
        }),
    );
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.runtime.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.runtime.auth.withDatabaseClient(client, () =>
        work(client),
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.throwDatabaseError(error);
    } finally {
      client.release();
    }
  }

  private async mutate<T>(
    actor: PlatformPrincipal,
    event: string,
    target: string | null,
    requestId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await action();
    } catch (error) {
      const code =
        error instanceof ApiException
          ? (error.getResponse() as { code: ApiErrorCode }).code
          : 'INTERNAL_ERROR';
      try {
        await this.runtime.pool.query(
          'SELECT public.record_platform_identity_failure($1,$2,$3,$4,$5,$6)',
          [actor.userId, actor.sessionId, event, target, requestId, code],
        );
      } catch {
        throw new ApiException(503, 'AUDIT_UNAVAILABLE');
      }
      throw error;
    }
  }

  private async call<T>(
    statement: string,
    values: unknown[],
    executor: Pick<AuthRuntime['pool'], 'query'> = this.runtime.pool,
  ): Promise<T> {
    try {
      return (await executor.query<{ result: T }>(statement, values)).rows[0]
        .result;
    } catch (error) {
      this.throwDatabaseError(error);
    }
  }

  private throwDatabaseError(error: unknown): never {
    const statuses: Partial<Record<ApiErrorCode, number>> = {
      FORBIDDEN: 403,
      UNAUTHENTICATED: 401,
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      ACCOUNT_SUSPENDED: 403,
      LAST_PLATFORM_SUPERADMIN: 409,
      BUILT_IN_ROLE_IMMUTABLE: 403,
      EMAIL_ALREADY_EXISTS: 409,
      VERSION_CONFLICT: 409,
      AUDIT_UNAVAILABLE: 503,
      AUTHORIZATION_UNAVAILABLE: 503,
    };
    rethrowPlatformDatabaseError(error, statuses);
  }
}
