import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiErrorCodeSchema } from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from './files-runtime';
import { FileLease } from './file-lease';
import { StorageError } from './storage/storage';
import {
  reconcileFileObjectPlan,
  type FileObjectMaintenanceJob,
} from './file-object-plan';

type OrganizationCandidate = {
  organizationId: string;
  kind: 'operation' | 'history' | 'trash';
  id: string;
};
type PersonalCandidate = {
  userId: string;
  kind: 'upload' | 'media';
  id: string;
};
type PersonalJob = {
  userId: string;
  kind: PersonalCandidate['kind'];
  id: string;
  mediaId: string;
  leaseExpiresAt: string;
  storagePath: string[];
};
type LeasedJob<T> = { job: T | null; time: Date };

function remaining(expiry: string, databaseTime: Date): number {
  return new Date(expiry).getTime() - databaseTime.getTime();
}

function failureCode(error: unknown): string {
  if (error instanceof Error) {
    const parsed = ApiErrorCodeSchema.safeParse(error.message);
    if (parsed.success) return parsed.data;
    if (error.message === 'FILE_OPERATION_LEASE_CONFLICT') return error.message;
  }
  return 'FILE_STORAGE_UNAVAILABLE';
}

@Injectable()
export class FileMaintenance implements OnModuleDestroy {
  private readonly logger = new Logger(FileMaintenance.name);
  private stopSignal = new AbortController();
  private active = false;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;

  constructor(
    private readonly identity: AuthRuntime,
    private readonly runtime: FilesRuntime,
  ) {}

  start(): void {
    if (this.active || !this.runtime.enabled) return;
    this.active = true;
    this.stopSignal = new AbortController();
    this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.stopSignal.abort(new StorageError('STORAGE_UNAVAILABLE'));
    await this.running;
  }

  private tick(): void {
    if (!this.active) return;
    this.running = this.runOnce()
      .then(() => {})
      .catch((error: unknown) => {
        this.logger.error({
          event: 'files.maintenance.scan_failed',
          errorCode: failureCode(error),
        });
      })
      .finally(() => {
        if (this.active) this.timer = setTimeout(() => this.tick(), 30_000);
      });
  }

  async runOnce(limit = 100): Promise<number> {
    if (!this.runtime.enabled) return 0;
    const [organizations, personal] = await Promise.all([
      this.identity.pool.query<{ candidates: OrganizationCandidate[] }>(
        'SELECT public.get_file_maintenance_candidates($1::integer) AS candidates',
        [limit],
      ),
      this.identity.pool.query<{ candidates: PersonalCandidate[] }>(
        'SELECT public.get_personal_media_maintenance_candidates($1::integer) AS candidates',
        [limit],
      ),
    ]);
    let completed = 0;
    // 扫描不占租约；每项先持有同 owner 的物理锁，再按当前数据库事实认领。
    for (const candidate of organizations.rows[0].candidates) {
      if (this.stopSignal.signal.aborted) break;
      if (await this.reconcileOrganization(candidate)) completed++;
    }
    for (const candidate of personal.rows[0].candidates) {
      if (this.stopSignal.signal.aborted) break;
      if (await this.reconcilePersonal(candidate)) completed++;
    }
    return completed;
  }

  async reconcileOrganization(
    candidate: OrganizationCandidate,
  ): Promise<boolean> {
    const leaseId = randomUUID();
    const requestId = randomUUID();
    let claimed: FileObjectMaintenanceJob | null = null;
    try {
      return await this.runtime.requirePhysicalScope().run(
        { kind: 'organization', id: candidate.organizationId },
        async (scopeSignal) => {
          const physicalSignal = AbortSignal.any([
            scopeSignal,
            this.stopSignal.signal,
          ]);
          physicalSignal.throwIfAborted();
          const claimStarted = performance.now();
          const result = await this.identity.pool.query<
            LeasedJob<FileObjectMaintenanceJob>
          >(
            `WITH claimed AS MATERIALIZED (SELECT public.claim_file_maintenance($1::uuid,$2::text,$3::uuid,$4::uuid,$5::text) AS job)
             SELECT job, clock_timestamp() AS time FROM claimed`,
            [
              candidate.organizationId,
              candidate.kind,
              candidate.id,
              leaseId,
              requestId,
            ],
          );
          const row = result.rows[0];
          claimed = row.job;
          if (!claimed) return false;
          const job = claimed;
          const lease = new FileLease(
            remaining(job.operation.lease_expires_at, row.time) -
              (performance.now() - claimStarted),
            physicalSignal,
            async () => {
              const renewStarted = performance.now();
              const renewed = await this.identity.pool.query<
                LeasedJob<FileObjectMaintenanceJob>
              >(
                `WITH renewed AS MATERIALIZED (SELECT public.renew_file_maintenance($1::uuid,$2::uuid,$3::uuid) AS job)
               SELECT job, clock_timestamp() AS time FROM renewed`,
                [job.organizationId, job.operationId, leaseId],
              );
              return (
                remaining(
                  renewed.rows[0].job!.operation.lease_expires_at,
                  renewed.rows[0].time,
                ) -
                (performance.now() - renewStarted)
              );
            },
          );
          try {
            await reconcileFileObjectPlan(
              this.identity.pool,
              this.runtime.requireStorage(),
              job,
              leaseId,
              lease.signal,
            );
            // 停续租并等正在执行的续租结束，避免结算后一次迟到续租误报失败。
            await lease.stop();
            lease.signal.throwIfAborted();
            await this.identity.pool.query(
              'SELECT public.finish_file_maintenance($1::uuid,$2::uuid,$3::uuid,$4::text)',
              [job.organizationId, job.operationId, leaseId, requestId],
            );
            return true;
          } finally {
            await lease.stop();
          }
        },
        this.stopSignal.signal,
      );
    } catch (error) {
      const code = failureCode(error);
      if (claimed) {
        const job = claimed as FileObjectMaintenanceJob;
        // 固定函数再次检查 token；失去租约的旧执行者不能更改新执行者的事实。
        await this.identity.pool
          .query(
            'SELECT public.record_file_maintenance_error($1::uuid,$2::uuid,$3::uuid,$4::text)',
            [job.organizationId, job.operationId, leaseId, code],
          )
          .catch(() => {});
      }
      this.logger.warn({
        event: 'files.maintenance.operation_failed',
        organizationId: candidate.organizationId,
        id: candidate.id,
        errorCode: code,
      });
      return false;
    }
  }

  async reconcilePersonal(candidate: PersonalCandidate): Promise<boolean> {
    const leaseId = randomUUID();
    let claimed = false;
    try {
      return await this.runtime.requirePhysicalScope().run(
        { kind: 'personal', id: candidate.userId },
        async (scopeSignal) => {
          const physicalSignal = AbortSignal.any([
            scopeSignal,
            this.stopSignal.signal,
          ]);
          physicalSignal.throwIfAborted();
          const claimStarted = performance.now();
          const result = await this.identity.pool.query<LeasedJob<PersonalJob>>(
            `WITH claimed AS MATERIALIZED (SELECT public.claim_personal_media_maintenance($1::uuid,$2::text,$3::uuid,$4::uuid) AS job)
           SELECT job, clock_timestamp() AS time FROM claimed`,
            [candidate.userId, candidate.kind, candidate.id, leaseId],
          );
          const row = result.rows[0];
          if (!row.job) return false;
          claimed = true;
          const job = row.job;
          const lease = new FileLease(
            remaining(job.leaseExpiresAt, row.time) -
              (performance.now() - claimStarted),
            physicalSignal,
            async () => {
              const renewStarted = performance.now();
              const renewed = await this.identity.pool.query<
                LeasedJob<PersonalJob>
              >(
                `WITH renewed AS MATERIALIZED (SELECT public.renew_personal_media_maintenance($1::uuid,$2::text,$3::uuid,$4::uuid) AS job)
             SELECT job, clock_timestamp() AS time FROM renewed`,
                [candidate.userId, candidate.kind, candidate.id, leaseId],
              );
              return (
                remaining(
                  renewed.rows[0].job!.leaseExpiresAt,
                  renewed.rows[0].time,
                ) -
                (performance.now() - renewStarted)
              );
            },
          );
          try {
            await this.runtime.requireStorage().remove(
              {
                owner: { kind: 'personal', id: job.userId },
                area: 'files',
                segments: job.storagePath,
              },
              lease.signal,
            );
            await lease.stop();
            lease.signal.throwIfAborted();
            await this.identity.pool.query(
              'SELECT public.finish_personal_media_maintenance($1::uuid,$2::text,$3::uuid,$4::uuid,$5::text)',
              [
                candidate.userId,
                candidate.kind,
                candidate.id,
                leaseId,
                randomUUID(),
              ],
            );
            return true;
          } finally {
            await lease.stop();
          }
        },
        this.stopSignal.signal,
      );
    } catch (error) {
      const code = failureCode(error);
      if (claimed)
        await this.identity.pool
          .query(
            'SELECT public.record_personal_media_maintenance_error($1::uuid,$2::text,$3::uuid,$4::uuid,$5::text)',
            [candidate.userId, candidate.kind, candidate.id, leaseId, code],
          )
          .catch(() => {});
      this.logger.warn({
        event: 'files.maintenance.personal_failed',
        userId: candidate.userId,
        id: candidate.id,
        errorCode: code,
      });
      return false;
    }
  }
}
