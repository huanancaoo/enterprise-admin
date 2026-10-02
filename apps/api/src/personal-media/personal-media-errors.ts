import { NotFoundException } from '@nestjs/common';
import { ApiErrorCodeSchema } from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { rethrowFileError } from '../files/file-http-errors';
import { StorageError } from '../files/storage/storage';

const databaseStatus: Record<string, number> = {
  UNAUTHENTICATED: 401,
  VALIDATION_ERROR: 400,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  PERSONAL_MEDIA_OPERATION_EXPIRED: 409,
  PERSONAL_MEDIA_CONTENT_MISMATCH: 409,
  AUDIT_UNAVAILABLE: 503,
};

export function personalFailureCode(error: unknown): string {
  if (error instanceof StorageError) return error.code;
  if (
    error instanceof Error &&
    (error.message in databaseStatus ||
      error.message === 'FILE_OPERATION_LEASE_CONFLICT')
  )
    return error.message;
  return 'PERSONAL_MEDIA_UPLOAD_FAILED';
}

export function rethrowPersonalMediaError(error: unknown): never {
  if (error instanceof Error) {
    if (
      [
        'PERSONAL_MEDIA_NOT_FOUND',
        'PERSONAL_MEDIA_OPERATION_NOT_FOUND',
      ].includes(error.message)
    )
      throw new NotFoundException();
    if (error.message === 'FILE_OPERATION_LEASE_CONFLICT')
      throw new ApiException(409, 'FILE_OPERATION_IN_PROGRESS');
    const status = databaseStatus[error.message];
    if (status)
      throw new ApiException(status, ApiErrorCodeSchema.parse(error.message));
  }
  rethrowFileError(error);
}
