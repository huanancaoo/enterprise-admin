import { Logger, type INestApplication } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRuntime } from '../identity/auth-runtime';
import { FileMaintenance } from './file-maintenance';
import { FilesRuntime } from './files-runtime';
import type { StorageOwner } from './storage/storage';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const applications: INestApplication[] = [];

async function setup(runtime: object = { enabled: true }, query = vi.fn()) {
  const module = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers: [
      FileMaintenance,
      { provide: AuthRuntime, useValue: { pool: { query } } },
      { provide: FilesRuntime, useValue: runtime },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  applications.push(app);
  await app.init();
  return {
    app,
    maintenance: app.get(FileMaintenance),
    scheduler: app.get(SchedulerRegistry),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(async () => {
  for (const app of applications.splice(0)) {
    const closing = app.close();
    await vi.advanceTimersByTimeAsync(100);
    await closing;
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('文件维护 Nest 调度生命周期', () => {
  it('显式启动立即执行且幂等；长任务结束后完整等待 30 秒', async () => {
    const { maintenance } = await setup();
    const first = deferred<number>();
    const run = vi
      .spyOn(maintenance, 'runOnce')
      .mockResolvedValue(0)
      .mockImplementationOnce(() => first.promise);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).not.toHaveBeenCalled();
    maintenance.start();
    maintenance.start();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(run).toHaveBeenCalledTimes(1);
    first.resolve(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('扫描失败后仍从失败完成时计时重试', async () => {
    const { maintenance } = await setup();
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const run = vi
      .spyOn(maintenance, 'runOnce')
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(0);
    maintenance.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(logged).toHaveBeenCalledWith({
      event: 'files.maintenance.scan_failed',
      errorCode: 'FILE_STORAGE_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('未启用文件功能时不注册或执行后台任务', async () => {
    const { maintenance, scheduler } = await setup({ enabled: false });
    const run = vi.spyOn(maintenance, 'runOnce');
    maintenance.start();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(run).not.toHaveBeenCalled();
    expect(scheduler.getCronJobs().size).toBe(0);
  });

  it('关闭空闲应用会释放下次任务，之后不再扫描', async () => {
    const { app, maintenance, scheduler } = await setup();
    const run = vi.spyOn(maintenance, 'runOnce').mockResolvedValue(0);
    maintenance.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(scheduler.getCronJobs().size).toBe(1);
    await app.close();
    applications.splice(applications.indexOf(app), 1);
    expect(scheduler.getCronJobs().size).toBe(0);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('关闭时中止物理操作，并等它退出后才释放运行时资源', async () => {
    const entered = deferred<AbortSignal>();
    const released = deferred<void>();
    const runtimeClosed = vi.fn();
    const candidate = {
      organizationId: 'org',
      kind: 'operation',
      id: 'operation',
    };
    const query = vi.fn((sql: string) =>
      Promise.resolve({
        rows: [
          {
            candidates: sql.includes('get_file_maintenance_candidates')
              ? [candidate]
              : [],
          },
        ],
      }),
    );
    const { app, maintenance, scheduler } = await setup(
      {
        enabled: true,
        requirePhysicalScope: () => ({
          run: async (
            _owner: StorageOwner,
            _work: unknown,
            signal: AbortSignal,
          ) => {
            entered.resolve(signal);
            await released.promise;
            return true;
          },
        }),
        onApplicationShutdown: runtimeClosed,
      },
      query,
    );
    maintenance.start();
    const signal = await entered.promise;
    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal.aborted).toBe(true);
    expect(closed).toBe(false);
    expect(runtimeClosed).not.toHaveBeenCalled();
    released.resolve();
    await vi.advanceTimersByTimeAsync(100);
    await closing;
    applications.splice(applications.indexOf(app), 1);
    expect(runtimeClosed).toHaveBeenCalledOnce();
    expect(scheduler.getCronJobs().size).toBe(0);
    const scans = query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(query).toHaveBeenCalledTimes(scans);
  });
});
