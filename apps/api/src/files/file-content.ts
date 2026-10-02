import { BadRequestException, Injectable } from '@nestjs/common';
import { create as createContentDisposition } from 'content-disposition';
import rangeParser from 'range-parser';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';
import { FilesRuntime } from './files-runtime';
import { rethrowFileError } from './file-http-errors';
import { filePreviewKind } from './file-responses';
import {
  StorageError,
  type ByteRange,
  type StoredRead,
} from './storage/storage';

export class FileRangeError extends ApiException {
  constructor(readonly totalBytes: number) {
    super(416, 'FILE_RANGE_INVALID');
  }
}

function requestedRange(
  header: string | undefined,
  total: number,
): ByteRange | undefined {
  if (header === undefined) return undefined;
  // 单范围及安全整数是此下载接口的策略，不能让库合并或忽略额外范围。
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || total === 0)
    throw new FileRangeError(total);
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if (
    (first !== undefined && !Number.isSafeInteger(first)) ||
    (last !== undefined && !Number.isSafeInteger(last))
  )
    throw new FileRangeError(total);
  // 超过对象长度的 suffix 仍表示整个对象；range-parser 会拒绝负起点，先限制 suffix。
  const value =
    first === undefined
      ? `bytes=-${Math.min(last!, total)}`
      : `bytes=${first}-${last ?? ''}`;
  const ranges = rangeParser(total, value, { combine: false });
  if (typeof ranges === 'number' || ranges.length !== 1)
    throw new FileRangeError(total);
  return ranges[0];
}

export function contentDisposition(
  name: string,
  contentType: string,
  requested: 'inline' | 'attachment',
): string {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  // 只有明确支持的被动媒体可预览；HTML、SVG 和 Office 的显式 inline 请求必须拒绝。
  if (requested === 'inline' && filePreviewKind(mime) === 'none')
    throw new BadRequestException();
  return createContentDisposition(name, {
    type: requested,
    fallback: false,
  });
}

@Injectable()
export class FileContent {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly files: FilesRuntime,
  ) {}

  async open(
    context: TenantContext,
    fileId: string,
    versionId: string,
    rangeHeader?: string,
    disposition: 'inline' | 'attachment' = 'attachment',
  ) {
    const storage = this.files.requireStorage();
    let read: StoredRead | undefined;
    try {
      return await createTenantRunner(this.runtime.pool)(
        context,
        async (tx) => {
          const { entry, version } = await fileRepository.findVersion(
            tx,
            fileId,
            versionId,
            'share',
          );
          const range = requestedRange(rangeHeader, version.bytes);
          const dispositionHeader = contentDisposition(
            entry.name,
            version.contentType,
            disposition,
          );
          // 定位与版本行保持 share 锁，直到取得真实句柄/对象流；清理不能抢先删除源。
          read = await storage.open(
            {
              owner: { kind: 'organization', id: context.organizationId },
              area: version.storageArea,
              segments: version.storagePath,
            },
            range,
          );
          const expectedBytes = range
            ? range.end - range.start + 1
            : version.bytes;
          if (
            read.totalBytes !== version.bytes ||
            read.bytes !== expectedBytes ||
            read.range?.start !== range?.start ||
            read.range?.end !== range?.end
          )
            throw new StorageError('STORAGE_RESPONSE_INVALID');
          return { entry, version, read, dispositionHeader };
        },
      );
    } catch (error) {
      // 事务提交或定位校验失败时也必须释放已打开的句柄。
      read?.body.destroy();
      rethrowFileError(error);
    }
  }
}
