import { NotFoundException } from '@nestjs/common';
import {
  ApiErrorCodeSchema,
  FileErrorCodeSchema,
  FileErrorDetailsSchema,
  type FileErrorCode,
} from '@workspace/contracts';
import { FilePathError } from '@workspace/contracts/file-path';
import { FileRepositoryError } from '@workspace/database/repositories/files';
import { ApiException } from '../http/api-exception';
import { StorageError } from './storage/storage';

const statusByCode: Record<FileErrorCode, number> = {
  FILE_NAME_CONFLICT: 409,
  FILE_NAME_INVALID: 400,
  FILE_NAME_TOO_LONG: 400,
  FILE_PATH_TOO_LONG: 400,
  FILE_FOLDER_CYCLE: 409,
  FILE_ROOT_PROTECTED: 409,
  FILE_REFERENCED: 409,
  FILE_RESTORE_EXPIRED: 409,
  FILE_QUOTA_EXCEEDED: 409,
  FILE_TOO_LARGE: 413,
  FILE_CONTENT_MISMATCH: 409,
  FILE_RANGE_INVALID: 416,
  FILE_OPERATION_IN_PROGRESS: 409,
  FILE_STORAGE_UNAVAILABLE: 503,
};

function publicDetails(facts: Record<string, unknown> | undefined) {
  if (!facts) return undefined;
  // Repository 的内部定位和操作计划不能进入公开错误响应。
  return FileErrorDetailsSchema.parse({
    operationId: facts.operationId,
    revision: facts.revision,
    maximumBytes: facts.maximumBytes,
    referenceCount: facts.referenceCount,
    quotaBytes: facts.quotaBytes,
    usedBytes: facts.usedBytes,
    reservedBytes: facts.reservedBytes,
  });
}

export function rethrowFileError(error: unknown): never {
  if (error instanceof FileRepositoryError) {
    if (
      [
        'FILE_NOT_FOUND',
        'FILE_FOLDER_NOT_FOUND',
        'FILE_VERSION_NOT_FOUND',
        'FILE_OPERATION_NOT_FOUND',
        'PROJECT_NOT_FOUND',
      ].includes(error.code)
    )
      throw new NotFoundException();
    const code = FileErrorCodeSchema.safeParse(error.code);
    if (code.success) {
      throw new ApiException(
        statusByCode[code.data],
        code.data,
        publicDetails(error.details),
      );
    }
    if (
      error.code === 'VERSION_CONFLICT' ||
      error.code === 'IDEMPOTENCY_KEY_REUSED'
    ) {
      const code = ApiErrorCodeSchema.parse(error.code);
      throw new ApiException(409, code, publicDetails(error.details));
    }
  }
  if (error instanceof FilePathError) {
    const code =
      error.code === 'FOLDER_NAME_TOO_LONG' ? 'FILE_NAME_TOO_LONG' : error.code;
    throw new ApiException(statusByCode[code], code);
  }
  if (error instanceof StorageError) {
    if (error.code === 'STORAGE_NOT_FOUND') throw new NotFoundException();
    if (error.code === 'STORAGE_RANGE_INVALID')
      throw new ApiException(416, 'FILE_RANGE_INVALID');
    if (
      error.code === 'STORAGE_CONTENT_MISMATCH' ||
      error.code === 'STORAGE_LENGTH_MISMATCH'
    )
      throw new ApiException(409, 'FILE_CONTENT_MISMATCH');
    if (error.code === 'STORAGE_CONFLICT')
      throw new ApiException(409, 'FILE_NAME_CONFLICT');
    throw new ApiException(503, 'FILE_STORAGE_UNAVAILABLE');
  }
  throw error;
}
