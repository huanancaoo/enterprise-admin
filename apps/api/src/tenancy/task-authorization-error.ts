import { TaskAuthorizationError } from '@workspace/database/task-tenant';
import { ApiException } from '../http/api-exception';

export function rethrowTaskAuthorizationError(error: unknown): never {
  if (!(error instanceof TaskAuthorizationError)) throw error;
  if (error.code === 'ACCOUNT_SUSPENDED')
    throw new ApiException(403, error.code);
  if (error.code === 'AUTHORIZATION_UNAVAILABLE')
    throw new ApiException(503, error.code);
  throw new ApiException(
    403,
    error.code === 'ORGANIZATION_SUSPENDED' ? error.code : 'FORBIDDEN',
  );
}
