import {
  type ApiErrorCode,
  type PlatformEmployeeOptionsQuery,
  type PlatformExportFilters,
} from '@workspace/contracts';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { AuthRuntime } from '../../identity/auth-runtime';
import type { Identity } from '../../identity/identity.service';
import { rethrowPlatformDatabaseError } from '../platform-database-error';

export type PlatformSystemActor = Pick<Identity, 'userId' | 'sessionId'>;
export type PlatformSystemExportQuery = PlatformExportFilters & {
  page?: number;
  pageSize?: number;
};
type Resource =
  | 'employee'
  | 'role'
  | 'department'
  | 'post'
  | 'dictionary'
  | 'dictionary-item'
  | 'parameter';
type Operation =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'set-status'
  | 'candidates'
  | 'batch-delete'
  | 'set-roles'
  | 'set-permissions'
  | 'employees'
  | 'assign-employees'
  | 'revoke-employees'
  | 'refresh'
  | 'by-key'
  | 'export-page';
const statuses: Partial<Record<ApiErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  TREE_CYCLE: 409,
  PARENT_DISABLED: 409,
  RESOURCE_IN_USE: 409,
  KEY_ALREADY_EXISTS: 409,
  LAST_PLATFORM_SUPERADMIN: 409,
  BUILT_IN_ROLE_IMMUTABLE: 409,
  EMAIL_ALREADY_EXISTS: 409,
  VERSION_CONFLICT: 409,
  AUDIT_UNAVAILABLE: 503,
  AUTHORIZATION_UNAVAILABLE: 503,
};

// 固定函数协议仅属于平台系统实现；HTTP 与任务通过具体资源能力调用。
export class PlatformSystemDatabase {
  constructor(private readonly pool: AuthRuntime['pool']) {}

  bind(kind: 'identity' | 'catalog', resource: Resource) {
    const statement =
      kind === 'identity'
        ? 'SELECT public.platform_system_identity($1,$2,$3,$4,$5,$6::jsonb,$7) AS result'
        : 'SELECT public.platform_system_catalog($1,$2,$3,$4,$5,$6::jsonb,$7) AS result';
    return <T>(
      actor: PlatformSystemActor,
      operation: Operation,
      id: string | null,
      input: object,
      requestId: string,
      schema: z.ZodType<T>,
      client?: PoolClient,
    ): Promise<T> => {
      // 任务导出沿用持锁连接；固定函数按每次操作重验当前任职与对应动作。
      return this.execute(
        statement,
        [
          actor.userId,
          actor.sessionId,
          resource,
          operation,
          id,
          JSON.stringify(input),
          requestId,
        ],
        schema,
        client,
      );
    };
  }

  employeeOptions<T>(
    actor: PlatformSystemActor,
    kind: 'department' | 'post' | 'role',
    input: PlatformEmployeeOptionsQuery,
    requestId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return this.execute(
      'SELECT public.list_platform_employee_options($1,$2,$3,$4::jsonb,$5) AS result',
      [actor.userId, actor.sessionId, kind, JSON.stringify(input), requestId],
      schema,
    );
  }

  private async execute<T>(
    statement: string,
    values: unknown[],
    schema: z.ZodType<T>,
    client?: PoolClient,
  ): Promise<T> {
    try {
      const result = (
        await (client ?? this.pool).query<{ result: unknown }>(
          statement,
          values,
        )
      ).rows[0].result;
      return schema.parse(result);
    } catch (error) {
      rethrowPlatformDatabaseError(error, statuses);
    }
  }
}
