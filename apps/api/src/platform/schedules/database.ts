import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { AuthRuntime } from '../../identity/auth-runtime';
import type { Identity } from '../../identity/identity.service';
import { rethrowPlatformDatabaseError } from '../platform-database-error';

export class PlatformScheduleDatabase {
  constructor(private readonly pool: AuthRuntime['pool']) {}
  async command<T>(
    actor: Identity,
    operation: string,
    id: string | null,
    input: object,
    requestId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      const result = await this.pool.query<{ result: unknown }>(
        'SELECT public.platform_schedule_command($1,$2,$3,$4,$5::jsonb,$6) AS result',
        [
          actor.userId,
          actor.sessionId,
          operation,
          id,
          JSON.stringify(input),
          requestId,
        ],
      );
      return schema.parse(result.rows[0].result);
    } catch (error) {
      this.rethrow(error);
    }
  }
  async runtime<T>(
    client: PoolClient,
    operation: string,
    id: string | null,
    input: object,
    requestId: string,
    schema: z.ZodType<T>,
    actor?: Identity,
  ): Promise<T> {
    try {
      const result = await client.query<{ result: unknown }>(
        'SELECT public.platform_schedule_runtime($1,$2,$3::jsonb,$4,$5,$6) AS result',
        [
          operation,
          id,
          JSON.stringify(input),
          actor?.userId ?? null,
          actor?.sessionId ?? null,
          requestId,
        ],
      );
      return schema.parse(result.rows[0].result);
    } catch (error) {
      this.rethrow(error);
    }
  }
  private rethrow(error: unknown): never {
    rethrowPlatformDatabaseError(error, {
      FORBIDDEN: 403,
      ACCOUNT_SUSPENDED: 403,
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      VERSION_CONFLICT: 409,
      RESOURCE_IN_USE: 409,
      AUDIT_UNAVAILABLE: 503,
      AUTHORIZATION_UNAVAILABLE: 503,
    });
  }
}
