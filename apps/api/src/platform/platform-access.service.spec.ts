import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../http/api-exception';
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
const fifteenMinutes = 15 * 60 * 1000;

function makeAccessService(mfaVerifiedAt: Date) {
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

afterEach(() => {
  vi.useRealTimers();
});

describe('PlatformAccessService recent MFA boundary', () => {
  it('accepts an assertion exactly 15 minutes old', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { service } = makeAccessService(
      new Date(now.getTime() - fifteenMinutes),
    );

    await expect(service.requireAccess(identity, true)).resolves.toMatchObject({
      userId: identity.userId,
      role: 'platform_admin',
      mfaVerifiedAt: new Date(now.getTime() - fifteenMinutes).toISOString(),
    });
  });

  it('requires a new assertion once it is more than 15 minutes old', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { service } = makeAccessService(
      new Date(now.getTime() - fifteenMinutes - 1),
    );

    const error = await service.requireAccess(identity, true).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ApiException);
    if (!(error instanceof ApiException)) return;
    expect(error.getStatus()).toBe(403);
    expect(error.getResponse()).toEqual({ code: 'PLATFORM_MFA_REQUIRED' });
  });
});

describe('PlatformGuard recent MFA policy', () => {
  it.each([
    { method: 'GET', required: false },
    { method: 'HEAD', required: false },
    { method: 'OPTIONS', required: false },
    { method: 'POST', required: true },
    { method: 'PUT', required: true },
    { method: 'PATCH', required: true },
    { method: 'DELETE', required: true },
  ])(
    'sets recent MFA requirement for $method to $required',
    async ({ method, required }) => {
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
      );
      const execution = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {}, method }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(execution)).resolves.toBe(true);
      expect(access.requireAccess).toHaveBeenCalledWith(identity, required);
    },
  );
});
