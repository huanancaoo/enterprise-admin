import type { OnApplicationShutdown } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import {
  createFileStorage,
  type FileStorage,
  type StorageConfig,
} from './storage/storage';
import { FilePhysicalScope } from './file-physical-scope';

export class FilesRuntime implements OnApplicationShutdown {
  constructor(
    private readonly storage?: FileStorage,
    private readonly physicalScope?: FilePhysicalScope,
  ) {}

  get enabled(): boolean {
    return this.storage !== undefined && this.physicalScope !== undefined;
  }

  requireStorage(): FileStorage {
    if (!this.storage) throw new NotFoundException();
    return this.storage;
  }

  requirePhysicalScope(): FilePhysicalScope {
    if (!this.physicalScope) throw new NotFoundException();
    return this.physicalScope;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.physicalScope?.[Symbol.asyncDispose]();
    await this.storage?.[Symbol.asyncDispose]();
  }
}

export async function createFilesRuntime(
  databaseURL: string,
  config?: StorageConfig,
): Promise<FilesRuntime> {
  // 启用时先验证真实目录或私有 bucket；错误配置不能启动一套不可用的文件服务。
  return new FilesRuntime(
    config ? await createFileStorage(config) : undefined,
    config ? new FilePhysicalScope(databaseURL) : undefined,
  );
}
