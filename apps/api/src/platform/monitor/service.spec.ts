import { PlatformMonitorSchema } from '@workspace/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesRuntime } from '../../files/files-runtime';
import type { AuthRuntime } from '../../identity/auth-runtime';
import type { PlatformPrincipal } from '../platform-access.service';
import type { PlatformTasks } from '../tasks/platform-tasks';
import {
  PlatformMonitorService,
  probeMonitorDependency,
  type PlatformMonitorConfig,
} from './service';

const queue = vi.hoisted(() => ({
  ping: vi.fn(),
  counts: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@workspace/jobs', async (original) => ({
  ...(await original<object>()),
  createQueueMonitor: () => queue,
}));
const actor = { permissions: ['platform.monitor:read'] } as PlatformPrincipal;
const config = {
  jobs: {},
  monitor: { timeoutMs: 50 },
} as PlatformMonitorConfig;
beforeEach(() => {
  queue.ping.mockResolvedValue('PONG');
  queue.counts.mockResolvedValue({
    waiting: 2,
    active: 1,
    delayed: 0,
    failed: 3,
  });
  queue.close.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());
describe('平台监控只读边界', () => {
  it('越权请求在探测前拒绝，租户身份不能获取运行数据', async () => {
    const query = vi.fn();
    const service = new PlatformMonitorService(
      { pool: { query } } as unknown as AuthRuntime,
      { enabled: false } as FilesRuntime,
      { executorRunning: true } as PlatformTasks,
      config,
    );
    await expect(
      service.read({ permissions: [] } as unknown as PlatformPrincipal),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(queue.ping).not.toHaveBeenCalled();
    expect(queue.counts).not.toHaveBeenCalled();
  });
  it('真实依赖分别投影，存储禁用及监控未配置不显示正常', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new PlatformMonitorService(
      { pool: { query } } as unknown as AuthRuntime,
      { enabled: false } as FilesRuntime,
      { executorRunning: true } as PlatformTasks,
      config,
    );
    const result = PlatformMonitorSchema.parse(await service.read(actor));
    expect(query).toHaveBeenCalledWith({ text: 'SELECT 1', query_timeout: 50 });
    expect(result.probes.find((item) => item.key === 'storage')).toEqual({
      key: 'storage',
      status: 'disabled',
    });
    expect(result.queues.map((item) => item.scope)).toEqual([
      'organization',
      'platform',
    ]);
    expect(result.platformExecutor).toBe('running');
    expect(result.worker.status).toBe('unconfigured');
    expect(JSON.stringify(result)).not.toContain('queueName');
    await service.onApplicationShutdown();
    expect(queue.close).toHaveBeenCalledOnce();
  });
  it('数据库、Redis和存储失败保持其他来源可读，不暴露原始异常', async () => {
    queue.ping.mockRejectedValue(new Error('redis-password'));
    queue.counts.mockRejectedValue(new Error('redis-password'));
    const storageProbe = vi.fn().mockRejectedValue(new Error('bucket-secret'));
    const service = new PlatformMonitorService(
      {
        pool: { query: vi.fn().mockRejectedValue(new Error('db-password')) },
      } as unknown as AuthRuntime,
      {
        enabled: true,
        requireStorage: () => ({ probe: storageProbe }),
      } as unknown as FilesRuntime,
      { executorRunning: false } as PlatformTasks,
      config,
    );
    const result = await service.read(actor);
    expect(result.probes.map((item) => item.status)).toEqual([
      'up',
      'down',
      'down',
      'down',
    ]);
    expect(result.queues.every((item) => item.status === 'unavailable')).toBe(
      true,
    );
    expect(result.platformExecutor).toBe('stopped');
    expect(JSON.stringify(result)).not.toMatch(/password|secret/);
  });
  it('卡住的探测按部署超时终止等待', async () => {
    const result = await probeMonitorDependency(
      'postgres',
      () => new Promise(() => {}),
      5,
    );
    expect(result.status).toBe('down');
  });
  it('卡住的队列不会让整个监控请求无限等待', async () => {
    queue.counts.mockImplementation(() => new Promise(() => {}));
    const service = new PlatformMonitorService(
      {
        pool: { query: vi.fn().mockResolvedValue({}) },
      } as unknown as AuthRuntime,
      { enabled: false } as FilesRuntime,
      { executorRunning: true } as PlatformTasks,
      config,
    );
    const result = await service.read(actor);
    expect(result.queues.map((item) => item.status)).toEqual([
      'unavailable',
      'unavailable',
    ]);
  });
});
