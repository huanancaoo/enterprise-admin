import { ForbiddenException, Injectable } from '@nestjs/common';
import type { PlatformAccess } from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import type { Identity } from '../identity/identity.service';
import { PlatformRuntime } from './platform-runtime';

export type PlatformPrincipal = Identity &
  Pick<PlatformAccess, 'role' | 'scope' | 'mfaVerifiedAt'>;

@Injectable()
export class PlatformAccessService {
  constructor(private readonly runtime: PlatformRuntime) {}

  async requireAccess(
    identity: Identity,
    requireRecentMfa = false,
  ): Promise<PlatformPrincipal> {
    const result = await this.runtime.pool.query<{
      role: PlatformAccess['role'];
      two_factor_enabled: boolean;
      mfa_verified_at: Date | null;
    }>(
      'SELECT role, two_factor_enabled, mfa_verified_at FROM public.read_platform_access($1, $2)',
      [identity.userId, identity.sessionId],
    );
    const access = result.rows[0];
    if (!access) throw new ForbiddenException();
    if (!access.two_factor_enabled || !access.mfa_verified_at) {
      throw new ApiException(403, 'PLATFORM_MFA_REQUIRED');
    }
    if (
      requireRecentMfa &&
      Date.now() - access.mfa_verified_at.getTime() > 15 * 60 * 1000
    ) {
      throw new ApiException(403, 'PLATFORM_MFA_REQUIRED');
    }
    return {
      ...identity,
      role: access.role,
      scope: 'global',
      mfaVerifiedAt: access.mfa_verified_at.toISOString(),
    };
  }
}
