import { Pool } from 'pg';
import { StorageError, storageKey, type StorageOwner } from './storage/storage';

export class FilePhysicalScope {
  private readonly pool: Pool;

  constructor(databaseURL: string) {
    // 等待物理锁的连接不能占满身份/事务连接池，否则持锁者无法提交执行事实。
    this.pool = new Pool({
      connectionString: databaseURL,
      application_name: 'enterprise-admin:files-physical-scope',
    });
  }

  async run<T>(
    owner: StorageOwner,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    storageKey({ owner, area: 'files', segments: [] }, true);
    const client = await this.pool.connect();
    const controller = new AbortController();
    const lostConnection = (error: Error) => {
      controller.abort(new StorageError('STORAGE_UNAVAILABLE', error));
    };
    client.on('error', lostConnection);
    let locked = false;
    try {
      // 租约只能协调数据库事实；整个物理阶段持同一连接锁，防止到期接管与旧 I/O 并行。
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        `enterprise-admin:files:${owner.kind}:${owner.id}`,
      ]);
      locked = true;
      controller.signal.throwIfAborted();
      const result = await work(controller.signal);
      controller.signal.throwIfAborted();
      return result;
    } finally {
      try {
        if (locked && !controller.signal.aborted)
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [`enterprise-admin:files:${owner.kind}:${owner.id}`],
          );
      } finally {
        client.off('error', lostConnection);
        client.release(controller.signal.aborted);
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.pool.end();
  }
}
