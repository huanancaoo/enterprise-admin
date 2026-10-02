import type { OnApplicationShutdown } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import {
  createFileStorage,
  type FileStorage,
  type StorageConfig,
} from './storage/storage';

export class FilesRuntime implements OnApplicationShutdown {
  constructor(private readonly storage?: FileStorage) {}

  requireStorage(): FileStorage {
    if (!this.storage) throw new NotFoundException();
    return this.storage;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.storage?.[Symbol.asyncDispose]();
  }
}

export async function createFilesRuntime(
  config?: StorageConfig,
): Promise<FilesRuntime> {
  // 启用时先验证真实目录或私有 bucket；错误配置不能启动一套不可用的文件服务。
  return new FilesRuntime(config ? await createFileStorage(config) : undefined);
}
