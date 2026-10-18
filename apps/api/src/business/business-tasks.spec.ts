import { expect, it, vi } from 'vitest';
import { readWorkerConfig } from '@workspace/jobs';
import type { TenantContext } from '@workspace/database/tenant';
import type { AuthRuntime } from '../identity/auth-runtime';
import type { AuthorizationService } from '../authorization/authorization.service';
import { BusinessTasks } from './business-tasks';

const create = vi.hoisted(() => vi.fn());

vi.mock('@workspace/database/task-tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@workspace/database/task-tenant')>()),
  createTaskTenantRunner:
    () =>
    async (
      _identity: unknown,
      _permissions: unknown,
      work: () => Promise<unknown>,
    ) =>
      work(),
}));
vi.mock('@workspace/database/repositories/business-tasks', () => ({
  businessTaskRepository: { create },
}));

it('提交保留 UUID 大小写归一化后的原 jobId 和业务资源 ID', async () => {
  const stop = new Error('stop before persisting');
  create.mockRejectedValueOnce(stop);
  const service = new BusinessTasks(
    {} as AuthRuntime,
    {} as AuthorizationService,
    readWorkerConfig({ REDIS_URL: 'redis://localhost:6379' }),
  );
  const context: TenantContext = {
    organizationId: '2A5E0BA1-1AA5-4FBD-8517-8C0131E3039C',
    userId: 'A7A151A7-1C98-40CE-9B63-0F22D2CF1D96',
    membershipId: 'c15a774b-815f-46ee-a1c3-6bde011f6650',
    locale: 'zh-CN',
    requestId: 'request-a',
  };
  await expect(
    service.export(
      context,
      { format: 'csv', filter: { sortBy: 'createdAt', sortOrder: 'desc' } },
      'one',
    ),
  ).rejects.toBe(stop);
  expect(create).toHaveBeenCalledWith(
    undefined,
    expect.objectContaining({
      jobId: 'f6d6c9d4d1538df4493f8f83fdd1a8ea56f69c945b42a18262fd99544418f9d1',
      id: 'f6d6c9d4-d153-4df4-a93f-8f83fdd1a8ea',
    }),
  );
});
