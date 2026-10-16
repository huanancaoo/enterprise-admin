import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Identity } from '../identity/identity.service';
import type { IdentityService } from '../identity/identity.service';
import type { AuthRuntime } from '../identity/auth-runtime';
import { PlatformAccessService } from './platform-access.service';
import { PlatformGuard } from './platform.guard';

const identity: Identity = {
  userId: 'platform-user',
  sessionId: 'active-session',
};

const now = new Date('2026-09-28T04:00:00.000Z');

function makeAccessService(mfaVerifiedAt: Date | null) {
  const pool = {
    query: vi.fn().mockResolvedValue({
      rows: [
        {
          role: 'platform_admin',
          two_factor_enabled: true,
          mfa_verified_at: mfaVerifiedAt,
        },
      ],
    }),
  };
  const runtime = { pool } as unknown as AuthRuntime;
  return { service: new PlatformAccessService(runtime), pool };
}

describe('PlatformAccessService optional MFA', () => {
  it('accepts a platform assignment without an MFA assertion', async () => {
    const { service } = makeAccessService(null);
    await expect(service.requireAccess(identity)).resolves.toMatchObject({
      userId: identity.userId,
      role: 'platform_admin',
      mfaVerifiedAt: null,
    });
  });

  it('returns voluntary MFA metadata without imposing an age limit', async () => {
    const { service } = makeAccessService(now);
    await expect(service.requireAccess(identity)).resolves.toMatchObject({
      mfaVerifiedAt: now.toISOString(),
    });
  });
});

describe('PlatformGuard session and assignment policy', () => {
  it.each([
    { method: 'GET' },
    { method: 'HEAD' },
    { method: 'OPTIONS' },
    { method: 'POST' },
    { method: 'PUT' },
    { method: 'PATCH' },
    { method: 'DELETE' },
  ])(
    'checks the platform assignment for $method without a separate MFA gate',
    async ({ method }) => {
      const access = {
        requireAccess: vi.fn().mockResolvedValue({
          ...identity,
          role: 'platform_admin',
          scope: 'global',
          mfaVerifiedAt: now.toISOString(),
        }),
      };
      const identityService = {
        requireIdentity: vi.fn().mockResolvedValue(identity),
      };
      const guard = new PlatformGuard(
        identityService as unknown as IdentityService,
        access as unknown as PlatformAccessService,
        { trustedOrigins: ['http://localhost:3201'] } as unknown as AuthRuntime,
      );
      const execution = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { origin: 'http://localhost:3201' },
            method,
          }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(execution)).resolves.toBe(true);
      expect(access.requireAccess).toHaveBeenCalledWith(identity);
    },
  );
});
