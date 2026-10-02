import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  rm,
  rmdir,
  unlink,
  copyFile,
} from 'node:fs/promises';
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

  async createDirectory(address: StorageAddress): Promise<void> {
    try {
      const path = await this.path(address, true);
      if (address.segments.length === 0)
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      storageFailure(error);
    }
  }

  async ensureOwner(owner: StorageOwner): Promise<void> {
    try {
      for (const area of ['files', 'history', 'trash', 'staging'] as const) {
        const path = await this.path({ owner, area, segments: [] }, true);
        await mkdir(path, { recursive: true, mode: 0o700 });
        const info = await lstat(path);
        if (!info.isDirectory() || (info.mode & 0o077) !== 0)
          throw new StorageError('STORAGE_UNSAFE_PATH');
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async directoryExists(address: StorageAddress): Promise<boolean> {
    try {
      const info = await lstat(await this.path(address, true));
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
  ): Promise<ContentFacts> {
    try {
      const path = await this.path(address);
      const measured = measuredContent(source, declaredBytes);
      const file = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(measured.stream);
        await file.sync();
        return measured.facts();
      } catch (error) {
        await unlink(path);
        throw error;
      } finally {
        await file.close();
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async open(address: StorageAddress, range?: ByteRange): Promise<StoredRead> {
    try {
      const file = await open(
        await this.path(address),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await file.stat();
        if (!info.isFile()) throw new StorageError('STORAGE_LOCATION_INVALID');
        const selected = range ? checkedRange(range, info.size) : undefined;
        return {
          body: file.createReadStream(selected),
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
  ): Promise<void> {
    assertSameOwner(source, target);
    try {
      const from = await this.path(source);
      const to = await this.path(target);
      await copyFile(from, to, constants.COPYFILE_EXCL);
      try {
        await verifyContent(await this.open(target), expected);
      } catch (error) {
        await unlink(to);
        throw error;
      }
    } catch (error) {
      storageFailure(error);
    }
  }

  async remove(address: StorageAddress): Promise<void> {
    try {
      await unlink(await this.path(address));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        storageFailure(error);
    }
  }

  async removeDirectory(address: StorageAddress): Promise<void> {
    if (address.segments.length === 0)
      throw new StorageError('STORAGE_ROOT_PROTECTED');
    try {
      await rmdir(await this.path(address, true));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        storageFailure(error);
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve();
  }
}
