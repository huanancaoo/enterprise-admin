import type { PoolClient } from 'pg';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createQueueMonitor, type WorkerConfig } from '@workspace/jobs';
import type {
  MonitorProbe,
  MonitorQueue,
  PlatformMonitor,
} from '@workspace/contracts';
import { AuthRuntime } from '../../identity/auth-runtime';
import { FilesRuntime } from '../../files/files-runtime';
import { ApiException } from '../../http/api-exception';
import type { PlatformPrincipal } from '../platform-access.service';
import { PlatformTasks } from '../platform-tasks';
import type { MonitorConfig } from './config';
import { readPrometheusMonitor } from './prometheus';

export type PlatformMonitorConfig = {
  monitor: MonitorConfig;
  jobs: WorkerConfig;
};

export async function monitorDeadline<T>(
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('MONITOR_TIMEOUT')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function probeMonitorDependency(
  key: MonitorProbe['key'],
  work: () => Promise<unknown>,
  timeoutMs: number,
): Promise<MonitorProbe> {
  const started = performance.now();
  try {
    await monitorDeadline(work, timeoutMs);
    return { key, status: 'up', latencyMs: performance.now() - started };
  } catch {
    return { key, status: 'down', latencyMs: performance.now() - started };
  }
}

@Injectable()
export class PlatformMonitorService implements OnApplicationShutdown {
  private queues?: ReturnType<typeof createQueueMonitor>;
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly files: FilesRuntime,
    private readonly tasks: PlatformTasks,
    private readonly config: PlatformMonitorConfig,
  ) {}
  async read(actor: PlatformPrincipal): Promise<PlatformMonitor> {
    if (!actor.permissions.includes('platform.monitor:read'))
      throw new ApiException(403, 'FORBIDDEN');
    return this.collect();
  }
  async collect(
    database: Pick<PoolClient, 'query'> = this.runtime.pool,
  ): Promise<PlatformMonitor> {
    const queueMonitor = (this.queues ??= createQueueMonitor(
      this.config.jobs,
      this.config.monitor.timeoutMs,
    ));
    const observedAt = new Date().toISOString();
    const timeoutMs = this.config.monitor.timeoutMs;
    const databaseProbe = { text: 'SELECT 1', query_timeout: timeoutMs };
    const [postgres, redis, storage, queues, metrics] = await Promise.all([
      probeMonitorDependency(
        'postgres',
        () => database.query(databaseProbe),
        timeoutMs,
      ),
      probeMonitorDependency('redis', () => queueMonitor.ping(), timeoutMs),
      this.files.enabled
        ? probeMonitorDependency(
            'storage',
            () =>
              this.files.requireStorage().probe(AbortSignal.timeout(timeoutMs)),
            timeoutMs,
          )
        : Promise.resolve<MonitorProbe>({ key: 'storage', status: 'disabled' }),
      Promise.all(
        (['organization', 'platform'] as const).map(
          async (scope): Promise<MonitorQueue> => {
            try {
              const counts = await monitorDeadline(
                () => queueMonitor.counts(scope),
                timeoutMs,
              );
              return {
                scope,
                status: 'ready',
                waiting: counts.waiting,
                active: counts.active,
                delayed: counts.delayed,
                failed: counts.failed,
              };
            } catch {
              return { scope, status: 'unavailable' };
            }
          },
        ),
      ),
      readPrometheusMonitor(this.config.monitor, Date.now()),
    ]);
    return {
      observedAt,
      probes: [{ key: 'api', status: 'up' }, postgres, redis, storage],
      queues,
      platformExecutor: this.tasks.executorRunning ? 'running' : 'stopped',
      ...metrics,
    };
  }
  async onApplicationShutdown() {
    await this.queues?.close();
  }
}
