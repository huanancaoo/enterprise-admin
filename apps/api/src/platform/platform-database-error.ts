import { ApiErrorCodeSchema, type ApiErrorCode } from '@workspace/contracts';
import { ApiException } from '../http/api-exception';

type Statuses = Readonly<Partial<Record<ApiErrorCode, number>>>;

export function platformDatabaseFailure(error: unknown, statuses: Statuses) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'P0001')
    return undefined;
  const parsed = ApiErrorCodeSchema.safeParse(error.message);
  if (!parsed.success) return undefined;
  const status = statuses[parsed.data];
  // 每个通道决定自己可以公开的错误；共享识别不能扩大其白名单。
  return status ? { code: parsed.data, status } : undefined;
}

export function rethrowPlatformDatabaseError(
  error: unknown,
  statuses: Statuses,
): never {
  const failure = platformDatabaseFailure(error, statuses);
  if (failure) throw new ApiException(failure.status, failure.code);
  throw error;
}
