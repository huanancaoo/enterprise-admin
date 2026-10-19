import type { TenantContext } from '@workspace/database/tenant';
import { readWorkerConfig } from '@workspace/jobs';
import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthorizationService } from '../authorization/authorization.service';
import type { AuthRuntime } from '../identity/auth-runtime';
import { BusinessTasks } from './business-tasks';

const { create, tx } = vi.hoisted(() => ({ create: vi.fn(), tx: {} }));
beforeEach(() => {
  create.mockReset();
});

vi.mock('@workspace/database/task-tenant', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@workspace/database/task-tenant')>()),
  createTaskTenantRunner:
    () =>
    async (
      _identity: unknown,
      _permissions: unknown,
      work: (tx: unknown) => Promise<unknown>,
    ) =>
      work(tx),
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
    service.submit(
      context,
      { format: 'csv', filter: { sortBy: 'createdAt', sortOrder: 'desc' } },
      'one',
      'projects.export',
    ),
  ).rejects.toBe(stop);
  expect(create).toHaveBeenCalledWith(
    tx,
    expect.objectContaining({
      jobId: 'f6d6c9d4d1538df4493f8f83fdd1a8ea56f69c945b42a18262fd99544418f9d1',
      id: 'f6d6c9d4-d153-4df4-a93f-8f83fdd1a8ea',
    }),
  );
});

it('领域校验与意图写入使用同一事务，校验拒绝时不写入意图', async () => {
  const service = new BusinessTasks(
    {} as AuthRuntime,
    {} as AuthorizationService,
    readWorkerConfig({ REDIS_URL: 'redis://localhost:6379' }),
  );
  const context = {
    organizationId: '2a5e0ba1-1aa5-4fbd-8517-8c0131e3039c',
    userId: 'a7a151a7-1c98-40ce-9b63-0f22d2cf1d96',
    membershipId: 'c15a774b-815f-46ee-a1c3-6bde011f6650',
    locale: 'zh-CN',
    requestId: 'request-a',
  } as TenantContext;
  const input = {
    format: 'csv' as const,
    filter: { sortBy: 'createdAt', sortOrder: 'desc' },
  };
  const rejected = new Error('domain rejected');
  const validate = vi.fn().mockRejectedValue(rejected);
  await expect(
    service.submit(context, input, 'one', 'projects.export', validate),
  ).rejects.toBe(rejected);
  expect(validate).toHaveBeenCalledWith(tx);
  expect(create).not.toHaveBeenCalled();

  const stop = new Error('stop at persistence');
  validate.mockResolvedValue(undefined);
  create.mockImplementation((transaction: unknown) => {
    expect(transaction).toBe(tx);
    expect(validate).toHaveBeenCalledTimes(2);
    throw stop;
  });
  await expect(
    service.submit(context, input, 'one', 'projects.export', validate),
  ).rejects.toBe(stop);
  expect(create).toHaveBeenCalledOnce();
});
