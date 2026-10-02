import type { Pool } from 'pg';
import type { TenantContext } from '@workspace/database/tenant';
import {
  fileRepository,
  type FileOperationObject,
} from '@workspace/database/repositories/files';
import type { FileWriteScope } from './file-write-executor';
import {
  StorageError,
  verifyContent,
  type ContentFacts,
  type FileStorage,
  type StorageAddress,
} from './storage/storage';

type Side = 'source' | 'target';
type PlannedObject = {
  id: string;
  directory: boolean;
  sourceArea: StorageAddress['area'] | null;
  sourcePath: string[] | null;
  targetArea: StorageAddress['area'] | null;
  targetPath: string[] | null;
  sourceDeleted: boolean;
  sourceDeletionStarted: boolean;
  sourceRestored: boolean;
  targetDeleted: boolean;
  expectedBytes: number | null;
  expectedSha256: string | null;
};
type Deletion = { object: PlannedObject; side: Side };
type RecordDeletion = (deletions: Deletion[]) => Promise<void>;
type RecordRestoration = (object: PlannedObject) => Promise<void>;

type MaintenanceObject = {
  id: string;
  directory: boolean;
  source_area: StorageAddress['area'] | null;
  source_path: string[] | null;
  target_area: StorageAddress['area'] | null;
  target_path: string[] | null;
  source_deleted_at: string | null;
  source_deletion_started_at: string | null;
  source_restored_at: string | null;
  target_deleted_at: string | null;
  expected_bytes: number | null;
  expected_sha256: string | null;
};
export type FileObjectMaintenanceJob = {
  organizationId: string;
  operationId: string;
  mode:
    | 'finish_commit'
    | 'finish_purge'
    | 'abort_uncommitted'
    | 'history_purge'
    | 'trash_purge';
  operation: { lease_expires_at: string };
  objects: MaintenanceObject[];
};

function writeObject(object: FileOperationObject): PlannedObject {
  return {
    ...object,
    sourceDeleted: object.sourceDeletedAt !== null,
    sourceDeletionStarted: object.sourceDeletionStartedAt !== null,
    sourceRestored: object.sourceRestoredAt !== null,
    targetDeleted: object.targetDeletedAt !== null,
  };
}

function contentFacts(object: PlannedObject): ContentFacts {
  if (object.expectedBytes === null || object.expectedSha256 === null)
    throw new StorageError('STORAGE_RESPONSE_INVALID');
  return { bytes: object.expectedBytes, sha256: object.expectedSha256 };
}

// 对象阶段只在已持有物理锁和有效租约的入口运行；授权、发布与结算仍由各入口负责。
class FileObjectPlan {
  constructor(
    readonly objects: PlannedObject[],
    private readonly organizationId: string,
    private readonly storage: FileStorage,
    private readonly signal: AbortSignal,
  ) {}

  private address(object: PlannedObject, side: Side): StorageAddress {
    const area = side === 'source' ? object.sourceArea : object.targetArea;
    const segments = side === 'source' ? object.sourcePath : object.targetPath;
    if (!area || !segments) throw new StorageError('STORAGE_RESPONSE_INVALID');
    return {
      owner: { kind: 'organization', id: this.organizationId },
      area,
      segments,
    };
  }

  private creationOrder(objects: PlannedObject[], side: Side): PlannedObject[] {
    return [...objects].sort((a, b) => {
      if (a.directory !== b.directory) return a.directory ? -1 : 1;
      return (
        this.address(a, side).segments.length -
        this.address(b, side).segments.length
      );
    });
  }

  async prepareTargets(
    objects: PlannedObject[],
    record: (object: PlannedObject) => Promise<void>,
  ): Promise<void> {
    // 计划按 UUID 返回；目录先于子对象落地，不能依赖查询结果的偶然顺序。
    for (const object of this.creationOrder(objects, 'target')) {
      this.signal.throwIfAborted();
      const target = this.address(object, 'target');
      if (object.directory)
        await this.storage.createDirectory(target, this.signal);
      else
        await this.storage.copy(
          this.address(object, 'source'),
          target,
          contentFacts(object),
          this.signal,
        );
      await record(object);
    }
  }

  private pending(side: Side): Deletion[] {
    return this.objects
      .filter((object) =>
        side === 'source'
          ? object.sourceArea !== null && !object.sourceDeleted
          : object.targetArea !== null && !object.targetDeleted,
      )
      .map((object) => ({ object, side }));
  }

  async remove(deletions: Deletion[], record: RecordDeletion): Promise<void> {
    // staging 同时是上传目标和替换副本的源；一次物理删除必须确认所有对应事实。
    const groups = new Map<
      string,
      { address: StorageAddress; directory: boolean; deletions: Deletion[] }
    >();
    for (const deletion of deletions) {
      const address = this.address(deletion.object, deletion.side);
      const key = JSON.stringify([
        address.area,
        address.segments,
        deletion.object.directory,
      ]);
      const group = groups.get(key);
      if (group) group.deletions.push(deletion);
      else
        groups.set(key, {
          address,
          directory: deletion.object.directory,
          deletions: [deletion],
        });
    }
    const ordered = [...groups.values()].sort((a, b) =>
      a.directory !== b.directory
        ? a.directory
          ? 1
          : -1
        : b.address.segments.length - a.address.segments.length,
    );
    for (const group of ordered) {
      this.signal.throwIfAborted();
      if (group.directory)
        await this.storage.removeDirectory(group.address, this.signal);
      else await this.storage.remove(group.address, this.signal);
      this.signal.throwIfAborted();
      await record(group.deletions);
      for (const { object, side } of group.deletions) {
        if (side === 'source') object.sourceDeleted = true;
        else object.targetDeleted = true;
      }
    }
  }

  async cleanupSources(
    record: RecordDeletion,
    includeStaging: boolean,
  ): Promise<void> {
    const deletions = this.pending('source');
    if (includeStaging)
      deletions.push(
        ...this.pending('target').filter(
          ({ object }) => object.targetArea === 'staging',
        ),
      );
    await this.remove(deletions, record);
  }

  async reconcile(
    mode: FileObjectMaintenanceJob['mode'],
    recordDeletion: RecordDeletion,
    recordRestoration: RecordRestoration,
  ): Promise<void> {
    if (mode !== 'abort_uncommitted') {
      await this.cleanupSources(recordDeletion, mode === 'finish_commit');
      return;
    }
    const sources = this.creationOrder(
      this.objects.filter(
        (object) =>
          (object.sourceDeletionStarted || object.sourceDeleted) &&
          !object.sourceRestored,
      ),
      'source',
    );
    for (const object of sources) {
      this.signal.throwIfAborted();
      const source = this.address(object, 'source');
      // 失败的新目标可能占据旧源路径；先确认其删除，再恢复旧源，后续不能删除恢复物。
      const replacements = this.pending('target').filter(
        ({ object: candidate }) =>
          candidate.targetArea === source.area &&
          JSON.stringify(candidate.targetPath) ===
            JSON.stringify(source.segments),
      );
      await this.remove(replacements, recordDeletion);
      if (object.directory) {
        if (!(await this.storage.directoryExists(source, this.signal)))
          await this.storage.createDirectory(source, this.signal);
      } else {
        const expected = contentFacts(object);
        try {
          await verifyContent(
            await this.storage.open(source, undefined, this.signal),
            expected,
          );
        } catch (error) {
          if (
            !(error instanceof StorageError) ||
            error.code !== 'STORAGE_NOT_FOUND'
          )
            throw error;
          await this.storage.copy(
            this.address(object, 'target'),
            source,
            expected,
            this.signal,
          );
        }
      }
      this.signal.throwIfAborted();
      await recordRestoration(object);
      object.sourceRestored = true;
    }
    await this.remove(this.pending('target'), recordDeletion);
  }
}

export function createFileWriteObjectPlan(
  context: TenantContext,
  scope: FileWriteScope,
  objects: FileOperationObject[],
) {
  const plan = new FileObjectPlan(
    objects.map(writeObject),
    context.organizationId,
    scope.storage,
    scope.signal,
  );
  const prepared = (object: PlannedObject, transientBytes: number) =>
    scope.write(async (tx) => {
      await fileRepository.recordPreparedObject(
        tx,
        scope.operation.id,
        object.id,
        {
          bytes: object.expectedBytes ?? 0,
          sha256: object.expectedSha256,
          transientBytes,
        },
        scope.leaseId,
      );
    });
  const deleted: RecordDeletion = (deletions) =>
    scope.write(async (tx, now) => {
      for (const { object, side } of deletions)
        await fileRepository.recordObjectDeleted(
          tx,
          scope.operation.id,
          object.id,
          side,
          now,
        );
    });
  return {
    prepareTargets: () =>
      plan.prepareTargets(
        // 无源的上传对象由流入口核对并登记，这里只执行目录和已有副本的复制计划。
        plan.objects.filter(
          (object) =>
            object.targetArea !== null &&
            (object.directory || object.sourceArea !== null),
        ),
        (object) =>
          prepared(object, object.directory ? 0 : object.expectedBytes!),
      ),
    async replaceSource(
      archiveObjectId: string,
      replacement: FileOperationObject,
    ): Promise<void> {
      const archive = plan.objects.find(
        (object) => object.id === archiveObjectId,
      )!;
      // 调用前的同一事务已持久化删除意图与 replacement；旧源确认删除后才能占据它的路径。
      await plan.remove([{ object: archive, side: 'source' }], deleted);
      const object = writeObject(replacement);
      plan.objects.push(object);
      await plan.prepareTargets([object], (preparedObject) =>
        prepared(preparedObject, 0),
      );
    },
    removeSources: () =>
      plan.cleanupSources(deleted, scope.operation.action === 'overwrite'),
  };
}

export async function reconcileFileObjectPlan(
  pool: Pool,
  storage: FileStorage,
  job: FileObjectMaintenanceJob,
  leaseId: string,
  signal: AbortSignal,
): Promise<void> {
  const plan = new FileObjectPlan(
    job.objects.map((object) => ({
      id: object.id,
      directory: object.directory,
      sourceArea: object.source_area,
      sourcePath: object.source_path,
      targetArea: object.target_area,
      targetPath: object.target_path,
      sourceDeleted: object.source_deleted_at !== null,
      sourceDeletionStarted: object.source_deletion_started_at !== null,
      sourceRestored: object.source_restored_at !== null,
      targetDeleted: object.target_deleted_at !== null,
      expectedBytes: object.expected_bytes,
      expectedSha256: object.expected_sha256,
    })),
    job.organizationId,
    storage,
    signal,
  );
  const record = async (
    object: PlannedObject,
    fact: 'source_deleted' | 'target_deleted' | 'source_restored',
  ): Promise<void> => {
    // 维护只提交既有租约的对象事实，不借用用户 TenantTx 或重新执行用户操作。
    await pool.query(
      'SELECT public.record_file_maintenance_object($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::bigint,$7::text)',
      [
        job.organizationId,
        job.operationId,
        leaseId,
        object.id,
        fact,
        fact === 'source_restored' ? object.expectedBytes : null,
        fact === 'source_restored' ? object.expectedSha256 : null,
      ],
    );
  };
  await plan.reconcile(
    job.mode,
    async (deletions) => {
      for (const { object, side } of deletions)
        await record(
          object,
          side === 'source' ? 'source_deleted' : 'target_deleted',
        );
    },
    (object) => record(object, 'source_restored'),
  );
}
