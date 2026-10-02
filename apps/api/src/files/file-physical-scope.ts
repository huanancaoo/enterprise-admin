import { Client, Pool, type PoolClient } from 'pg';
import { StorageError, storageKey, type StorageOwner } from './storage/storage';

export class FilePhysicalScope {
  private readonly pool: Pool;

  constructor(private readonly databaseURL: string) {
    // 等待物理锁的连接不能占满身份/事务连接池，否则持锁者无法提交执行事实。
    this.pool = new Pool({
      connectionString: databaseURL,
      application_name: 'enterprise-admin:files-physical-scope',
    });
  }

  async run<T>(
    owner: StorageOwner,
    work: (signal: AbortSignal, client: PoolClient) => Promise<T>,
    shutdown?: AbortSignal,
  ): Promise<T> {
    storageKey({ owner, area: 'files', segments: [] }, true);
    if (shutdown?.aborted)
      throw new StorageError('STORAGE_UNAVAILABLE', shutdown.reason);
    const connecting = this.pool.connect();
    const client = await new Promise<PoolClient>((resolve, reject) => {
      const cancel = () =>
        reject(new StorageError('STORAGE_UNAVAILABLE', shutdown?.reason));
      shutdown?.addEventListener('abort', cancel, { once: true });
      void connecting.then(
        (connection) => {
          shutdown?.removeEventListener('abort', cancel);
          if (shutdown?.aborted) {
            connection.release(true);
            cancel();
          } else resolve(connection);
        },
        (error: unknown) => {
          shutdown?.removeEventListener('abort', cancel);
          reject(new StorageError('STORAGE_UNAVAILABLE', error));
        },
      );
      if (shutdown?.aborted) cancel();
    });
    const controller = new AbortController();
    let locked = false;
    let released = false;
    let backendId: number | undefined;
    let cancellation: Promise<void> | undefined;
    const cancelWaiting = () => {
      controller.abort(
        new StorageError('STORAGE_UNAVAILABLE', shutdown?.reason),
      );
      // 等待 advisory lock 时尚无工作可结束；取消当前查询后销毁专用连接。
      if (!locked && !released) {
        if (backendId !== undefined) {
          cancellation = this.cancelLockWait(backendId).catch(() => {
            released = true;
            client.release(true);
          });
        } else {
          released = true;
          client.release(true);
        }
      }
    };
    const lostConnection = (error: Error) => {
      controller.abort(new StorageError('STORAGE_UNAVAILABLE', error));
    };
    client.on('error', lostConnection);
    try {
      shutdown?.addEventListener('abort', cancelWaiting, { once: true });
      if (shutdown?.aborted) cancelWaiting();
      controller.signal.throwIfAborted();
      if (shutdown) {
        const result = await client.query<{ id: number }>(
          'SELECT pg_backend_pid() AS id',
        );
        backendId = result.rows[0].id;
        controller.signal.throwIfAborted();
      }
      // 租约只能协调数据库事实；整个物理阶段持同一连接锁，防止到期接管与旧 I/O 并行。
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [
        `enterprise-admin:files:${owner.kind}:${owner.id}`,
      ]);
      locked = true;
      controller.signal.throwIfAborted();
      const result = await work(controller.signal, client);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      controller.signal.throwIfAborted();
      throw error;
    } finally {
      try {
        if (locked && !controller.signal.aborted)
          await client.query(
            'SELECT pg_advisory_unlock(hashtextextended($1, 0))',
            [`enterprise-admin:files:${owner.kind}:${owner.id}`],
          );
      } finally {
        await cancellation;
        client.off('error', lostConnection);
        shutdown?.removeEventListener('abort', cancelWaiting);
        if (!released) client.release(controller.signal.aborted);
      }
    }
  }

  private async cancelLockWait(backendId: number): Promise<void> {
    // 关闭 TCP 不保证正在等 advisory lock 的 PostgreSQL 立刻检查断连；显式取消同角色查询。
    const cancellation = new Client({ connectionString: this.databaseURL });
    try {
      await cancellation.connect();
      await cancellation.query('SELECT pg_cancel_backend($1)', [backendId]);
    } finally {
      await cancellation.end();
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.pool.end();
  }
}
