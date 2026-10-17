import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PlatformAccess } from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import type { Identity } from '../identity/identity.service';
import { AuthRuntime } from '../identity/auth-runtime';

export type PlatformPrincipal = Identity &
  Pick<PlatformAccess, 'roles' | 'permissions' | 'scope' | 'mfaVerifiedAt'>;

@Injectable()
export class PlatformAccessService {
  constructor(private readonly runtime: AuthRuntime) {}

  async recordDenial(
    identity: Identity | undefined,
    reason: 'UNAUTHENTICATED' | 'FORBIDDEN',
    requestId: string,
  ): Promise<void> {
    try {
      await this.runtime.pool.query(
        'SELECT public.record_platform_access_denial($1, $2, $3)',
        [identity?.userId ?? null, reason, requestId],
      );
    } catch {
      throw new ApiException(503, 'AUDIT_UNAVAILABLE');
    }
  }

  async requireAccess(identity: Identity): Promise<PlatformPrincipal> {
    const result = await this.runtime.pool.query<{
      roles: PlatformAccess['roles'];
      permissions: string[];
      mfa_verified_at: Date | null;
    }>(
      'SELECT roles, permissions, mfa_verified_at FROM public.read_platform_access($1, $2)',
      [identity.userId, identity.sessionId],
    );
    const access = result.rows[0];
    if (!access) throw new ForbiddenException();
    return {
      ...identity,
      roles: access.roles,
      permissions: access.permissions,
      scope: 'global',
      mfaVerifiedAt: access.mfa_verified_at?.toISOString() ?? null,
    };
  }
}
