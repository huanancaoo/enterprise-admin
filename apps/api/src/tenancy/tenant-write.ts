import { Logger } from '@nestjs/common';
import { createDatabase } from '@workspace/database';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import { ApiException } from '../http/api-exception';

const logger = new Logger('TenantWrite');

function sqlstate(error: unknown): string | undefined {
  const value = error as { code?: string; cause?: { code?: string } };
  return value.cause?.code ?? value.code;
}

export async function runTenantWrite<T>(
  pool: ReturnType<typeof createDatabase>['pool'],
  context: TenantContext,
  work: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  try {
    return await createTenantRunner(pool)(context, work, 'write');
  } catch (error) {
    const code = sqlstate(error);
    if (code === 'ORS02') throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
    if (code === 'ORS01') {
      logger.error({
        event: 'organization.status.missing',
        organizationId: context.organizationId,
        requestId: context.requestId,
      });
      throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
    }
    throw error;
  }
}
