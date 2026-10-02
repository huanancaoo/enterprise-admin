import { constants } from 'node:fs';
import { lstat, mkdir, open, rm, rmdir, unlink } from 'node:fs/promises';
import { Readable, addAbortSignal } from 'node:stream';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertSameOwner,
  checkedRange,
  measuredContent,
  maximumStorageKeyBytes,
  storageFailure,
  storageKey,
  StorageError,
  verifyContent,
  type ByteRange,
  type ContentFacts,
  type FileStorage,
  type StorageAddress,
  type StorageOwner,
  type StoredRead,
} from './storage';

export class LocalFileStorage implements FileStorage {
  private constructor(private readonly root: string) {}

  static async create(root: string): Promise<LocalFileStorage> {
    if (!isAbsolute(root)) throw new StorageError('STORAGE_CONFIG_INVALID');
    const canonical = resolve(root);
    await LocalFileStorage.assertNoLinks(canonical, false);
    const info = await lstat(canonical);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0)
      throw new StorageError('STORAGE_CONFIG_INVALID');
    // 同级名称区分大小写是业务契约；不由底层文件系统隐式合并文件。
    const name = `.case-${randomUUID()}`;
    const probe = join(canonical, name);
    const alternate = join(canonical, name.toUpperCase());
    const first = await open(
      probe,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await first.close();
    try {
      const second = await open(
        alternate,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await second.close();
      await unlink(alternate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new StorageError('STORAGE_LOCAL_FILESYSTEM_UNSUPPORTED', error);
      throw error;
    } finally {
      await unlink(probe);
    }
    await LocalFileStorage.assertPathCapacity(canonical);
    return new LocalFileStorage(canonical);
  }

  private static async assertPathCapacity(root: string): Promise<void> {
    const name = `.budget-${randomUUID()}`;
    const probe = join(root, name);
    await mkdir(probe, { mode: 0o700 });
    try {
      // 探测完整物理预算，避免部署根目录挤占用户的 512 字节相对路径。
      const tail =
        maximumStorageKeyBytes - Buffer.byteLength(name) - 255 * 2 - 3;
      const parent = join(probe, 'a'.repeat(255), 'b'.repeat(255));
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const file = await open(
        join(parent, 'c'.repeat(tail)),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await file.close();
    } catch (error) {
      throw new StorageError('STORAGE_CONFIG_INVALID', error);
    } finally {
      await rm(probe, { recursive: true });
    }
  }

  private static async assertNoLinks(
    path: string,
    missing: boolean,
  ): Promise<void> {
    const root = parse(path).root;
    let current = root;
    for (const segment of path.slice(root.length).split('/')) {
      current = join(current, segment);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new StorageError('STORAGE_UNSAFE_PATH');
      } catch (error) {
        if (missing && (error as NodeJS.ErrnoException).code === 'ENOENT')
          return;
        throw error;
      }
    }
  }

  private async path(
    address: StorageAddress,
    directory = false,
  ): Promise<string> {
    const path = join(this.root, storageKey(address, directory));
    await LocalFileStorage.assertNoLinks(path, true);
    return path;
  }

  async createDirectory(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      signal?.throwIfAborted();
      const path = await this.path(address, true);
      signal?.throwIfAborted();
      if (address.segments.length === 0)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      signal?.throwIfAborted();
      await mkdir(path, { mode: 0o700 });
      signal?.throwIfAborted();
    } catch (error) {
      storageFailure(error);
    }
  }

  async ensureOwner(owner: StorageOwner, signal?: AbortSignal): Promise<void> {
    try {
      for (const area of ['files', 'history', 'trash', 'staging'] as const) {
        signal?.throwIfAborted();
        const path = await this.path({ owner, area, segments: [] }, true);
        signal?.throwIfAborted();
        await mkdir(path, { recursive: true, mode: 0o700 });
        const info = await lstat(path);
        if (!info.isDirectory() || (info.mode & 0o077) !== 0)
          throw new StorageError('STORAGE_UNSAFE_PATH');
        signal?.throwIfAborted();
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async directoryExists(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      signal?.throwIfAborted();
      const info = await lstat(await this.path(address, true));
      signal?.throwIfAborted();
      if (!info.isDirectory() || (info.mode & 0o077) !== 0)
        throw new StorageError('STORAGE_UNSAFE_PATH');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      storageFailure(error);
    }
  }

  async write(
    address: StorageAddress,
    source: AsyncIterable<Uint8Array>,
    declaredBytes: number,
    signal?: AbortSignal,
  ): Promise<ContentFacts> {
    try {
      signal?.throwIfAborted();
      const path = await this.path(address);
      signal?.throwIfAborted();
      const measured = measuredContent(source, declaredBytes, signal);
      const file = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      const body = Readable.from(measured.stream, { objectMode: false });
      if (signal) addAbortSignal(signal, body);
      try {
        await file.writeFile(body, { signal });
        signal?.throwIfAborted();
        await file.sync();
        signal?.throwIfAborted();
        return measured.facts();
      } catch (error) {
        // 失去物理锁或租约后的残留由持久化计划清理，不能再自行开始删除。
        if (!signal?.aborted) await unlink(path);
        throw error;
      } finally {
        body.destroy();
        await file.close();
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async open(
    address: StorageAddress,
    range?: ByteRange,
    signal?: AbortSignal,
  ): Promise<StoredRead> {
    try {
      signal?.throwIfAborted();
      const file = await open(
        await this.path(address),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        signal?.throwIfAborted();
        const info = await file.stat();
        if (!info.isFile()) throw new StorageError('STORAGE_LOCATION_INVALID');
        const selected = range ? checkedRange(range, info.size) : undefined;
        signal?.throwIfAborted();
        return {
          body: file.createReadStream({ ...selected, signal }),
          bytes: selected ? selected.end - selected.start + 1 : info.size,
          totalBytes: info.size,
          ...(selected ? { range: selected } : {}),
        };
      } catch (error) {
        await file.close();
        throw error;
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async copy(
    source: StorageAddress,
    target: StorageAddress,
    expected: ContentFacts,
    signal?: AbortSignal,
  ): Promise<void> {
    assertSameOwner(source, target);
    try {
      signal?.throwIfAborted();
      const from = await this.open(source, undefined, signal);
      try {
        await this.write(target, from.body, expected.bytes, signal);
        try {
          await verifyContent(
            await this.open(target, undefined, signal),
            expected,
          );
          signal?.throwIfAborted();
        } catch (error) {
          if (!signal?.aborted) await this.remove(target);
          throw error;
        }
      } finally {
        from.body.destroy();
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async remove(address: StorageAddress, signal?: AbortSignal): Promise<void> {
    try {
      signal?.throwIfAborted();
      const path = await this.path(address);
      signal?.throwIfAborted();
      await unlink(path);
      signal?.throwIfAborted();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        storageFailure(error);
    }
  }

  async removeDirectory(
    address: StorageAddress,
    signal?: AbortSignal,
  ): Promise<void> {
    if (address.segments.length === 0)
      throw new StorageError('STORAGE_ROOT_PROTECTED');
    try {
      signal?.throwIfAborted();
      const path = await this.path(address, true);
      signal?.throwIfAborted();
      await rmdir(path);
      signal?.throwIfAborted();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        storageFailure(error);
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }
}
