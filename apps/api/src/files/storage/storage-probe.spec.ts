import { mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalFileStorage } from './local-storage';

describe('本地存储只读运行探针', () => {
  it('不创建owner目录或测试对象，并发现启动后根目录失效', async () => {
    const parent = await mkdtemp(
      join(await realpath(tmpdir()), 'monitor-storage-'),
    );
    const root = join(parent, 'storage');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(root, { mode: 0o700 });
    try {
      // 探针只验证已配置目录；启动时的大小写写入探测与本用例无关。
      const storage = Reflect.construct(LocalFileStorage, [
        root,
      ]) as LocalFileStorage;
      const before = await readdir(root);
      await storage.probe();
      expect(await readdir(root)).toEqual(before);
      await rename(root, join(parent, 'moved'));
      await expect(storage.probe()).rejects.toThrow('STORAGE_NOT_FOUND');
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
