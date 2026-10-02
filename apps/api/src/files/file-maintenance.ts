import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiErrorCodeSchema } from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import { FilesRuntime } from './files-runtime';
import { FileLease } from './file-lease';
import {
  StorageError,
  verifyContent,
  type ContentFacts,
  type FileStorage,
  type StorageAddress,
} from './storage/storage';

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
type OperationObject = {
  id: string;
  directory: boolean;
  source_area: StorageAddress['area'] | null;
  source_path: string[] | null;
  target_area: StorageAddress['area'] | null;
  target_path: string[] | null;
  source_deleted_at: string | null;
  source_restored_at: string | null;
  target_deleted_at: string | null;
  expected_bytes: number | null;
  expected_sha256: string | null;
};
type OrganizationJob = {
  organizationId: string;
  operationId: string;
  mode:
    | 'finish_commit'
    | 'finish_purge'
    | 'abort_uncommitted'
    | 'history_purge'
    | 'trash_purge';
  operation: { lease_expires_at: string };
  objects: OperationObject[];
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

function facts(object: OperationObject): ContentFacts {
  if (object.expected_bytes === null || object.expected_sha256 === null)
    throw new StorageError('STORAGE_RESPONSE_INVALID');
  return { bytes: object.expected_bytes, sha256: object.expected_sha256 };
}

function address(
  job: OrganizationJob,
  object: OperationObject,
  side: 'source' | 'target',
): StorageAddress {
  const area = side === 'source' ? object.source_area : object.target_area;
  const segments = side === 'source' ? object.source_path : object.target_path;
  if (!area || !segments) throw new StorageError('STORAGE_RESPONSE_INVALID');
  return {
    owner: { kind: 'organization', id: job.organizationId },
    area,
    segments,
  };
}

function removalOrder(objects: OperationObject[], side: 'source' | 'target') {
  return [...objects].sort((a, b) => {
    if (a.directory !== b.directory) return a.directory ? 1 : -1;
    const aPath = side === 'source' ? a.source_path : a.target_path;
    const bPath = side === 'source' ? b.source_path : b.target_path;
    return (bPath?.length ?? 0) - (aPath?.length ?? 0);
  });
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
    let claimed: OrganizationJob | null = null;
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
            LeasedJob<OrganizationJob>
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
                LeasedJob<OrganizationJob>
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
            const storage = this.runtime.requireStorage();
            if (job.mode === 'abort_uncommitted')
              await this.restoreSources(storage, job, leaseId, lease.signal);
            const side = job.mode === 'abort_uncommitted' ? 'target' : 'source';
            const objects = job.objects.filter((object) =>
              side === 'target'
                ? object.target_area !== null &&
                  object.target_deleted_at === null
                : object.source_area !== null &&
                  object.source_deleted_at === null,
            );
            await this.removeObjects(
              storage,
              job,
              leaseId,
              objects,
              side,
              lease.signal,
            );
            if (job.mode === 'finish_commit')
              await this.removeObjects(
                storage,
                job,
                leaseId,
                job.objects.filter(
                  (object) =>
                    object.target_area === 'staging' &&
                    object.target_deleted_at === null,
                ),
                'target',
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
        const job = claimed as OrganizationJob;
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

  private async restoreSources(
    storage: FileStorage,
    job: OrganizationJob,
    leaseId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const objects = job.objects
      .filter(
        (object) =>
          object.source_deleted_at !== null &&
          object.source_restored_at === null,
      )
      .sort((a, b) =>
        a.directory !== b.directory
          ? a.directory
            ? -1
            : 1
          : (a.source_path?.length ?? 0) - (b.source_path?.length ?? 0),
      );
    for (const object of objects) {
      signal.throwIfAborted();
      const source = address(job, object, 'source');
      // 覆盖失败的新目标可能占据旧源路径；先记录其删除，再恢复旧源，后续不能删除恢复物。
      const replacements = job.objects.filter(
        (candidate) =>
          candidate.target_deleted_at === null &&
          candidate.target_area === source.area &&
          JSON.stringify(candidate.target_path) ===
            JSON.stringify(source.segments),
      );
      await this.removeObjects(
        storage,
        job,
        leaseId,
        replacements,
        'target',
        signal,
      );
      if (object.directory) {
        if (!(await storage.directoryExists(source, signal)))
          await storage.createDirectory(source, signal);
      } else {
        const expected = facts(object);
        try {
          await verifyContent(
            await storage.open(source, undefined, signal),
            expected,
          );
        } catch (error) {
          if (
            !(error instanceof StorageError) ||
            error.code !== 'STORAGE_NOT_FOUND'
          )
            throw error;
          await storage.copy(
            address(job, object, 'target'),
            source,
            expected,
            signal,
          );
        }
      }
      signal.throwIfAborted();
      await this.record(
        job,
        leaseId,
        object,
        'source_restored',
        object.expected_bytes,
        object.expected_sha256,
      );
      object.source_restored_at = new Date().toISOString();
    }
  }

  private async removeObjects(
    storage: FileStorage,
    job: OrganizationJob,
    leaseId: string,
    objects: OperationObject[],
    side: 'source' | 'target',
    signal: AbortSignal,
  ): Promise<void> {
    for (const object of removalOrder(objects, side)) {
      signal.throwIfAborted();
      const location = address(job, object, side);
      if (object.directory) await storage.removeDirectory(location, signal);
      else await storage.remove(location, signal);
      signal.throwIfAborted();
      await this.record(
        job,
        leaseId,
        object,
        side === 'source' ? 'source_deleted' : 'target_deleted',
      );
      if (side === 'source')
        object.source_deleted_at = new Date().toISOString();
      else object.target_deleted_at = new Date().toISOString();
    }
  }

  private async record(
    job: OrganizationJob,
    leaseId: string,
    object: OperationObject,
    fact: string,
    bytes: number | null = null,
    sha256: string | null = null,
  ): Promise<void> {
    await this.identity.pool.query(
      'SELECT public.record_file_maintenance_object($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::bigint,$7::text)',
      [
        job.organizationId,
        job.operationId,
        leaseId,
        object.id,
        fact,
        bytes,
        sha256,
      ],
    );
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
