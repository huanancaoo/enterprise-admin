import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  PlatformScheduleSchema,
  PlatformSchedulePageSchema,
  PlatformScheduleRunSchema,
  PlatformScheduleRunPageSchema,
  DeletePlatformScheduleSchema,
  type CreatePlatformSchedule,
  type UpdatePlatformSchedule,
  type PlatformSchedule,
  type PlatformScheduleQuery,
  type PlatformScheduleRunsQuery,
  type PlatformScheduleRun,
} from '@workspace/contracts';
import { operationalLogger } from '@workspace/observability';
import { AuthRuntime } from '../../identity/auth-runtime';
import type { PlatformPrincipal } from '../platform-access.service';
import { PlatformMonitorService } from '../monitor/service';
import { ApiException } from '../../http/api-exception';
import { PlatformScheduleDatabase } from './database';
import {
  executeRegisteredSchedule,
  nextScheduleOccurrence,
  platformScheduleTypes,
} from './registry';

const scheduleLock =
  "SELECT pg_try_advisory_lock(hashtextextended('platform.schedule:'||$1::text,0)) AS locked";
const scheduleUnlock =
  "SELECT pg_advisory_unlock(hashtextextended('platform.schedule:'||$1::text,0))";

@Injectable()
export class PlatformSchedules implements OnApplicationShutdown {
  private readonly database: PlatformScheduleDatabase;
  private leader?: PoolClient;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private tickWork?: Promise<void>;
  private readonly executions = new Set<Promise<void>>();
  private readonly clients = new WeakMap<
    PoolClient,
    { broken: boolean; onError: () => void }
  >();
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly monitor: PlatformMonitorService,
  ) {
    this.database = new PlatformScheduleDatabase(runtime.pool);
  }
  private async connect(): Promise<PoolClient> {
    const client = await this.runtime.pool.connect();
    const state = {
      broken: false,
      onError: () => {
        state.broken = true;
        operationalLogger.error({
          event: 'platform_schedule_connection_failed',
          code: 'SCHEDULE_CONNECTION_UNAVAILABLE',
        });
      },
    };
    // 持有运行锁时连接并非pool的idle连接，必须由执行器接管error事件。
    client.on('error', state.onError);
    this.clients.set(client, state);
    return client;
  }
  private release(client: PoolClient, discard = false): void {
    const state = this.clients.get(client)!;
    this.clients.delete(client);
    client.release(discard || state.broken);
    client.off('error', state.onError);
  }
  async types(actor: PlatformPrincipal, requestId: string) {
    await this.database.command(actor, 'types', null, {}, requestId, z.null());
    return platformScheduleTypes;
  }
  list(
    actor: PlatformPrincipal,
    query: PlatformScheduleQuery,
    requestId: string,
  ) {
    return this.database.command(
      actor,
      'list',
      null,
      query,
      requestId,
      PlatformSchedulePageSchema,
    );
  }
  get(actor: PlatformPrincipal, id: string, requestId: string) {
    return this.database.command(
      actor,
      'get',
      id,
      {},
      requestId,
      PlatformScheduleSchema,
    );
  }
  create(
    actor: PlatformPrincipal,
    input: CreatePlatformSchedule,
    requestId: string,
  ) {
    return this.database.command(
      actor,
      'create',
      null,
      this.withNextRun(input),
      requestId,
      PlatformScheduleSchema,
    );
  }
  update(
    actor: PlatformPrincipal,
    id: string,
    input: UpdatePlatformSchedule,
    requestId: string,
  ) {
    return this.database.command(
      actor,
      'update',
      id,
      this.withNextRun(input),
      requestId,
      PlatformScheduleSchema,
    );
  }
  delete(actor: PlatformPrincipal, id: string, requestId: string) {
    return this.database.command(
      actor,
      'delete',
      id,
      {},
      requestId,
      DeletePlatformScheduleSchema,
    );
  }
  runs(
    actor: PlatformPrincipal,
    id: string,
    query: PlatformScheduleRunsQuery,
    requestId: string,
  ) {
    return this.database.command(
      actor,
      'runs',
      id,
      query,
      requestId,
      PlatformScheduleRunPageSchema,
    );
  }
  private withNextRun<T extends CreatePlatformSchedule>(input: T) {
    const next = nextScheduleOccurrence(input.cron, input.timeZone, new Date());
    return { ...input, nextRunAt: input.status === 'enabled' ? next : null };
  }
  async run(
    actor: PlatformPrincipal,
    id: string,
    requestId: string,
  ): Promise<PlatformScheduleRun> {
    const client = await this.connect();
    let locked = false;
    try {
      locked = (await client.query<{ locked: boolean }>(scheduleLock, [id]))
        .rows[0].locked;
      if (!locked) throw new ApiException(409, 'RESOURCE_IN_USE');
      const run = await this.database.runtime(
        client,
        'claim',
        id,
        { trigger: 'manual' },
        requestId,
        PlatformScheduleRunSchema,
        actor,
      );
      if (run.status === 'running') {
        this.launch(run, client, requestId);
        return run;
      }
      await client.query(scheduleUnlock, [id]);
      this.release(client);
      return run;
    } catch (error) {
      if (locked)
        await client.query(scheduleUnlock, [id]).catch(() => undefined);
      this.release(client);
      throw error;
    }
  }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.tickWork = this.tick();
  }
  private async tick(): Promise<void> {
    try {
      if (!this.leader) {
        const client = await this.connect();
        let acquired;
        try {
          acquired = await client.query<{ locked: boolean }>(
            'SELECT pg_try_advisory_lock(20261019,1) AS locked',
          );
        } catch (error) {
          this.release(client, true);
          throw error;
        }
        if (!acquired.rows[0].locked) this.release(client);
        else {
          this.leader = client;
          await this.database.runtime(
            client,
            'recover',
            null,
            {},
            randomUUID(),
            z.null(),
          );
          // 接任领导者后只从当前时刻向前计算，停机期间的触发点不会形成队列。
          await this.scan(true);
        }
      }
      if (this.leader) {
        await this.database.runtime(
          this.leader,
          'recover',
          null,
          {},
          randomUUID(),
          z.null(),
        );
        await this.scan(false);
      }
    } catch {
      if (this.leader) this.release(this.leader, true);
      this.leader = undefined;
      operationalLogger.error({
        event: 'platform_schedule_runtime_failed',
        code: 'SCHEDULE_RUNTIME_UNAVAILABLE',
      });
    }
    if (!this.stopped)
      this.timer = setTimeout(() => {
        this.tickWork = this.tick();
      }, 1000);
  }
  private async scan(reset: boolean): Promise<void> {
    const client = this.leader!;
    for (;;) {
      const due = await this.database.runtime(
        client,
        'due',
        null,
        {},
        randomUUID(),
        z.array(PlatformScheduleSchema),
      );
      if (!due.length || this.stopped) return;
      for (const schedule of due) {
        if (this.stopped) return;
        const nextRunAt = nextScheduleOccurrence(
          schedule.cron,
          schedule.timeZone,
          new Date(),
        );
        if (reset)
          await this.database.runtime(
            client,
            'reset',
            schedule.id,
            { expectedNextRunAt: schedule.nextRunAt, nextRunAt },
            randomUUID(),
            z.null(),
          );
        else await this.automatic(schedule, nextRunAt);
      }
      if (!reset) return;
    }
  }
  private async automatic(
    schedule: PlatformSchedule,
    nextRunAt: string,
  ): Promise<void> {
    const client = await this.connect();
    const requestId = randomUUID();
    let handedOff = false;
    let locked = false;
    try {
      locked = (
        await client.query<{ locked: boolean }>(scheduleLock, [schedule.id])
      ).rows[0].locked;
      if (!locked) {
        // 正在执行的计划跳过本次触发，不在手动运行结束后补出一个排队任务。
        await this.database.runtime(
          client,
          'reset',
          schedule.id,
          { expectedNextRunAt: schedule.nextRunAt, nextRunAt },
          requestId,
          z.null(),
        );
        return;
      }
      const run = await this.database.runtime(
        client,
        'claim',
        schedule.id,
        {
          trigger: 'automatic',
          expectedNextRunAt: schedule.nextRunAt,
          nextRunAt,
        },
        requestId,
        PlatformScheduleRunSchema.nullable(),
      );
      if (run?.status === 'running') {
        this.launch(run, client, requestId);
        handedOff = true;
      }
    } finally {
      if (!handedOff) {
        if (locked)
          await client
            .query(scheduleUnlock, [schedule.id])
            .catch(() => undefined);
        this.release(client);
      }
    }
  }
  private launch(
    run: PlatformScheduleRun,
    client: PoolClient,
    requestId: string,
  ): void {
    const work = this.execute(run, client, requestId).finally(() =>
      this.executions.delete(work),
    );
    this.executions.add(work);
  }
  private async execute(
    run: PlatformScheduleRun,
    client: PoolClient,
    requestId: string,
  ): Promise<void> {
    try {
      const result = await executeRegisteredSchedule(this.monitor, client);
      await this.database.runtime(
        client,
        'finish',
        run.scheduleId,
        { runId: run.id, status: 'succeeded', result },
        requestId,
        PlatformScheduleRunSchema,
      );
    } catch {
      try {
        await this.database.runtime(
          client,
          'finish',
          run.scheduleId,
          { runId: run.id, status: 'failed', errorCode: 'EXECUTION_FAILED' },
          requestId,
          PlatformScheduleRunSchema,
        );
      } catch {
        operationalLogger.error({
          event: 'platform_schedule_settlement_failed',
          code: 'SCHEDULE_SETTLEMENT_UNAVAILABLE',
        });
      }
    } finally {
      await client
        .query(scheduleUnlock, [run.scheduleId])
        .catch(() => undefined);
      this.release(client);
    }
  }
  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.tickWork;
    await Promise.all([...this.executions]);
    if (this.leader) {
      await this.leader
        .query('SELECT pg_advisory_unlock(20261019,1)')
        .catch(() => undefined);
      this.release(this.leader);
      this.leader = undefined;
    }
  }
}
