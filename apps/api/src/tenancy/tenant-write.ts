import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import {
  requireCurrentTenantActor,
  TenantActorError,
} from '@workspace/database/tenant-actor';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import { ApiException } from '../http/api-exception';

const logger = new Logger('TenantWrite');

function sqlstate(error: unknown): string | undefined {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}

@Injectable()
export class TenantWrite {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly authorization: AuthorizationService,
    private readonly identities: IdentityService,
  ) {}
  async transaction<T>(
    context: TenantContext,
    headers: Headers,
    permissions: readonly PermissionRequest[],
    work: (tx: TenantTx) => Promise<T>,
  ): Promise<T> {
    const credential = headers.has('x-api-key')
      ? await this.identities.requireBusinessIdentity(
          headers,
          context.organizationId,
        )
      : undefined;
    const client = await this.runtime.pool.connect();
    try {
      return await createTenantRunner(client)(context, async (tx) => {
        let actor: string | { credentialId: string };
        if (credential && 'credentialId' in credential) {
          if (credential.userId !== context.userId)
            throw new UnauthorizedException();
          actor = { credentialId: credential.credentialId };
        } else {
          const session = await this.runtime.auth.withDatabaseClient(
            client,
            () =>
              this.runtime.auth.api.getSession({
                headers,
                query: { disableCookieCache: true, disableRefresh: true },
              }),
          );
          if (!session || session.user.id !== context.userId)
            throw new UnauthorizedException();
          actor = session.session.id;
        }
        // 身份→组织→成员的锁序与原生组织写一致；不在工作前持有组织锁再等待 Session。
        await requireCurrentTenantActor(tx, actor);
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          permissions,
        );
        const result = await work(tx);
        await this.authorization.requireAnyPermissionInTransaction(
          client,
          headers,
          context.organizationId,
          permissions,
        );
        await requireCurrentTenantActor(tx, actor);
        return result;
      }).catch((error: unknown) => {
        if (error instanceof TenantActorError)
          throw new ApiException(
            error.code === 'UNAUTHENTICATED' ? 401 : 403,
            error.code,
          );
        return rethrowTenantWriteError(error, context);
      });
    } finally {
      client.release();
    }
  }
}

export function rethrowTenantWriteError(
  error: unknown,
  context: TenantContext,
): never {
  const code = sqlstate(error);
  if (code === 'ORS02') throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
  if (code === 'ORS01') {
    logger.error({
      event: 'organization.status.missing',
      organizationId: context.organizationId,
      requestId: context.requestId,
    });
    throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
  }
  const message = (error as { message?: string } | null)?.message;
  if (message === 'ACCOUNT_SUSPENDED')
    throw new ApiException(403, 'ACCOUNT_SUSPENDED');
  if (message === 'AUTHORIZATION_UNAVAILABLE')
    throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
  throw error;
}
