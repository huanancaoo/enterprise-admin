import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APIError } from 'better-auth/api';
import { describe, expect, it, vi } from 'vitest';
import { AuthRuntime } from '../identity/auth-runtime';
import { AuthorizationService } from './authorization.service';

async function setup() {
  const hasPermission = vi.fn().mockResolvedValue({ success: true });
  const module = await Test.createTestingModule({
    providers: [
      AuthorizationService,
      { provide: AuthRuntime, useValue: { auth: { api: { hasPermission } } } },
    ],
  }).compile();
  return { service: module.get(AuthorizationService), hasPermission };
}

describe('AuthorizationService', () => {
  it('空组织 ID 不能触发 Better Auth 的活跃组织选择', async () => {
    const { service, hasPermission } = await setup();
    await expect(
      service.requirePermission(new Headers(), '', { project: ['read'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(hasPermission).not.toHaveBeenCalled();
  });

  it('非成员与权限不足都转换为项目的禁止访问异常', async () => {
    const { service, hasPermission } = await setup();
    hasPermission.mockRejectedValueOnce(
      new APIError('UNAUTHORIZED', {
        code: 'USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION',
      }),
    );
    await expect(
      service.requirePermission(new Headers(), 'target', { project: ['read'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    hasPermission.mockResolvedValueOnce({ success: false });
    await expect(
      service.requirePermission(new Headers(), 'target', { project: ['read'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('基础设施错误不能伪装成无权限结果', async () => {
    const { service, hasPermission } = await setup();
    const failure = new Error('database unavailable');
    hasPermission.mockRejectedValueOnce(failure);
    await expect(
      service.requirePermission(new Headers(), 'target', { project: ['read'] }),
    ).rejects.toBe(failure);
  });
});
