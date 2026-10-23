import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  FileOperationResponseSchema,
  type FileOperationResponse,
} from '@workspace/contracts';
import { FileObjectPlan, type PlannedObject } from '../files/file-object-plan';
import { FileLease } from '../files/file-lease';
import type { FilesRuntime } from '../files/files-runtime';
import {
  platformFileStorageOwner,
  verifyContent,
  StorageError,
} from '../files/storage/storage';
import type {
  OrganizationFileUpload,
  OrganizationFileOverwrite,
} from '../files/file-upload-stream';
import { ApiException } from '../http/api-exception';
import type { PlatformFileActor } from './platform-files';

export type PlatformFileJournal = {
  id: string;
  lease_id: string;
  phase: string;
  action: string;
  objects: (PlannedObject & { targetPrepared: boolean })[];
  plans: { import?: boolean }[];
  committed_at: string | null;
  completed_at: string | null;
  result: unknown;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};
export async function platformFileCall<T>(
  client: Pick<PoolClient, 'query'>,
  name: string,
  args: unknown[],
): Promise<T> {
  const response = await client.query<{ result: T }>(
    `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS result`,
    args,
  );
  return response.rows[0].result;
}
function receipt(journal: PlatformFileJournal): FileOperationResponse {
  const timestamp = (value: string | null) =>
    value === null ? null : new Date(value).toISOString();
  return FileOperationResponseSchema.parse({
    id: journal.id,
    action: journal.action,
    phase: journal.phase,
    committedAt: timestamp(journal.committed_at),
    completedAt: timestamp(journal.completed_at),
    result: journal.result,
    errorCode: journal.error_code,
    createdAt: timestamp(journal.created_at),
    updatedAt: timestamp(journal.updated_at),
  });
}

export class PlatformFileExecutor {
  constructor(
    private readonly pool: Pool,
    private readonly files: FilesRuntime,
  ) {}

  private async reconcile(
    client: PoolClient,
    journal: PlatformFileJournal,
    signal: AbortSignal,
    code: string,
  ) {
    if (['completed', 'failed'].includes(journal.phase)) return;
    const plan = new FileObjectPlan(
      journal.objects,
      platformFileStorageOwner,
      this.files.requireStorage(),
      signal,
    );
    const fact = (object: PlannedObject, name: string) =>
      platformFileCall<void>(client, 'platform_file_object_fact', [
        journal.id,
        journal.lease_id,
        object.id,
        name,
      ]);
    if (journal.plans[0]?.import) {
      const storage = this.files.requireStorage();
      await storage.ensureOwner(platformFileStorageOwner, signal);
      for (const object of journal.objects.filter(
        (item) => !item.targetPrepared,
      )) {
        const target = {
          owner: platformFileStorageOwner,
          area: object.targetArea!,
          segments: object.targetPath!,
        };
        if (object.directory) {
          if (!(await storage.directoryExists(target, signal)))
            await storage.createDirectory(target, signal);
        } else {
          // 迁入中断可能留下尚未登记的副本；按计划校验后接续，损坏副本只从仍保留的源重建。
          try {
            await verifyContent(await storage.open(target, undefined, signal), {
              bytes: object.expectedBytes!,
              sha256: object.expectedSha256!,
            });
          } catch (error) {
            if (
              !(error instanceof StorageError) ||
              ![
                'STORAGE_NOT_FOUND',
                'STORAGE_LENGTH_MISMATCH',
                'STORAGE_CONTENT_MISMATCH',
              ].includes(error.code)
            )
              throw error;
            if (error.code !== 'STORAGE_NOT_FOUND')
              await storage.remove(target, signal);
            // 迁入跨越旧资源与文件库的归属；逐字节写入并核对摘要后，才允许计划清理旧源。
            const source = await storage.open(
              {
                owner: object.sourceOwner!,
                area: object.sourceArea!,
                segments: object.sourcePath!,
              },
              undefined,
              signal,
            );
            try {
              const written = await storage.write(
                target,
                source.body,
                object.expectedBytes!,
                signal,
              );
              if (
                written.bytes !== object.expectedBytes ||
                written.sha256 !== object.expectedSha256
              )
                throw new StorageError('STORAGE_CONTENT_MISMATCH');
            } finally {
              source.body.destroy();
            }
          }
        }
        await fact(object, 'targetPrepared');
      }
    }
    await plan.reconcile(
      journal.committed_at ? 'finish_commit' : 'abort_uncommitted',
      async (deletions) => {
        for (const { object, side } of deletions)
          await fact(
            object,
            side === 'source' ? 'sourceDeleted' : 'targetDeleted',
          );
      },
      (object) => fact(object, 'sourceRestored'),
    );
    await platformFileCall(client, 'platform_file_settle', [
      journal.id,
      journal.lease_id,
      code,
    ]);
  }

  private async recoverLocked(client: PoolClient, signal: AbortSignal) {
    while (!signal.aborted) {
      const journal = await platformFileCall<PlatformFileJournal | null>(
        client,
        'platform_file_claim',
        [randomUUID()],
      );
      if (!journal) return;
      const lease = new FileLease(90000, signal, () =>
        platformFileCall<number>(this.pool, 'platform_file_renew', [
          journal.id,
          journal.lease_id,
        ]),
      );
      try {
        await this.reconcile(
          client,
          journal,
          lease.signal,
          'FILE_STORAGE_UNAVAILABLE',
        );
      } finally {
        await lease.stop();
      }
    }
  }

  recover(signal?: AbortSignal) {
    return this.files
      .requirePhysicalScope()
      .run(
        platformFileStorageOwner,
        (signal, client) => this.recoverLocked(client, signal),
        signal,
      );
  }

  maintain(signal?: AbortSignal) {
    return this.files.requirePhysicalScope().run(
      platformFileStorageOwner,
      async (signal, client) => {
        await this.recoverLocked(client, signal);
        for (let index = 0; index < 100; index++) {
          const journal = await platformFileCall<PlatformFileJournal | null>(
            client,
            'platform_file_expire',
            [randomUUID()],
          );
          if (!journal) return;
          const lease = new FileLease(90000, signal, () =>
            platformFileCall<number>(this.pool, 'platform_file_renew', [
              journal.id,
              journal.lease_id,
            ]),
          );
          try {
            await this.reconcile(
              client,
              journal,
              lease.signal,
              'FILE_STORAGE_UNAVAILABLE',
            );
          } finally {
            await lease.stop();
          }
        }
      },
      signal,
    );
  }

  async execute(
    actor: PlatformFileActor,
    action: string,
    input: { operationId: string; [key: string]: unknown },
    requestId: string,
    upload?: OrganizationFileUpload | OrganizationFileOverwrite,
  ) {
    const storage = this.files.requireStorage();
    return this.files.requirePhysicalScope().run(
      platformFileStorageOwner,
      async (scopeSignal, client) => {
        await this.recoverLocked(client, scopeSignal);
        const leaseId = randomUUID();
        const call = <T>(name: string, args: unknown[]) =>
          platformFileCall<T>(client, name, args);
        const fact = (object: PlannedObject, name: string) =>
          call<void>('platform_file_object_fact', [
            input.operationId,
            leaseId,
            object.id,
            name,
          ]);
        const load = () =>
          call<PlatformFileJournal>('platform_file_journal', [
            input.operationId,
            leaseId,
          ]);
        let journal = await call<PlatformFileJournal>('platform_file_begin', [
          actor.userId,
          actor.sessionId,
          input.operationId,
          action,
          input,
          requestId,
          leaseId,
        ]);
        if (journal.lease_id !== leaseId) {
          await upload?.verifyReplay(scopeSignal);
          return receipt(journal);
        }
        const lease = new FileLease(
          90000,
          upload ? AbortSignal.any([scopeSignal, upload.signal]) : scopeSignal,
          () =>
            platformFileCall<number>(this.pool, 'platform_file_renew', [
              input.operationId,
              leaseId,
            ]),
        );
        try {
          const kind =
            action === 'create-folder' ? 'folder' : upload ? 'upload' : 'path';
          journal = await call<PlatformFileJournal>(
            `platform_file_prepare_${kind}`,
            [actor.userId, actor.sessionId, input.operationId, leaseId],
          );
          const plan = new FileObjectPlan(
            journal.objects,
            platformFileStorageOwner,
            storage,
            lease.signal,
          );
          await storage.ensureOwner(platformFileStorageOwner, lease.signal);
          if (upload) {
            const target = journal.objects[0];
            const facts = await upload.writeTo(
              storage,
              {
                owner: platformFileStorageOwner,
                area: target.targetArea!,
                segments: target.targetPath!,
              },
              lease.signal,
            );
            if (
              facts.bytes !== upload.fields.declaredBytes ||
              facts.sha256 !== upload.fields.contentSha256
            )
              throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
            await fact(target, 'targetPrepared');
            if (action === 'overwrite') {
              await plan.replaceSource(
                journal.objects.find(
                  (object) => object.targetArea === 'history',
                )!,
                async () => {
                  const replacement = await call<PlatformFileJournal>(
                    'platform_file_replace',
                    [input.operationId, leaseId],
                  );
                  return replacement.objects.find(
                    (object) => object.sourceArea === 'staging',
                  )!;
                },
                (object) => fact(object, 'targetPrepared'),
                async (deletions) => {
                  for (const { object } of deletions)
                    await fact(object, 'sourceDeleted');
                },
              );
            }
          } else {
            await plan.prepareTargets(
              journal.objects.filter((object) => object.targetArea !== null),
              (object) => fact(object, 'targetPrepared'),
            );
          }
          lease.signal.throwIfAborted();
          await call(`platform_file_commit_${kind}`, [
            actor.userId,
            actor.sessionId,
            input.operationId,
            leaseId,
          ]);
          journal = await load();
          await this.reconcile(client, journal, lease.signal, 'INTERNAL_ERROR');
          return receipt(await load());
        } catch (error) {
          if (!scopeSignal.aborted && !lease.signal.aborted) {
            // 只根据数据库已提交事实选择恢复方向；网络异常本身不能证明提交失败。
            journal = await load();
            const code =
              error instanceof ApiException
                ? (error.getResponse() as { code: string }).code
                : error instanceof Error &&
                    'code' in error &&
                    error.code === 'P0001'
                  ? error.message
                  : 'INTERNAL_ERROR';
            await this.reconcile(client, journal, scopeSignal, code);
            if (journal.committed_at) return receipt(await load());
          }
          throw error;
        } finally {
          await lease.stop();
        }
      },
      upload?.signal,
    );
  }
}
