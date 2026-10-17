import { Injectable } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import type { z } from 'zod';
import {
  ApiErrorCodeSchema,
  PlatformEmployeeSchema,
  type ApiErrorCode,
  type CreatePlatformEmployee,
  type PlatformEmployee,
  type PlatformEmployeeOptionsQuery,
} from '@workspace/contracts';
import { AuthRuntime } from '../identity/auth-runtime';
import { ApiException } from '../http/api-exception';
import type { PlatformPrincipal } from './platform-access.service';

type IdentityResource = 'employee' | 'role';
type CatalogResource =
  | 'menu'
  | 'department'
  | 'post'
  | 'dictionary'
  | 'dictionary-item'
  | 'parameter';
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

@Injectable()
export class PlatformSystem {
  constructor(private readonly runtime: AuthRuntime) {}

  async createEmployee(
    actor: PlatformPrincipal,
    input: CreatePlatformEmployee,
    requestId: string,
  ): Promise<PlatformEmployee> {
    if (input.mode === 'existing') {
      return this.identity(
        actor,
        'employee',
        'create',
        null,
        input,
        requestId,
        PlatformEmployeeSchema,
      );
    }
    // 凭据仅以 Better Auth 的原生哈希进入数据库函数，不能进入业务日志或返回对象。
    const { password, ...profile } = input;
    const passwordHash = await hashPassword(password);
    return this.identity(
      actor,
      'employee',
      'create',
      null,
      {
        ...profile,
        passwordHash,
      },
      requestId,
      PlatformEmployeeSchema,
    );
  }

  identity<T>(
    actor: PlatformPrincipal,
    resource: IdentityResource,
    operation: string,
    id: string | null,
    input: object,
    requestId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return this.call(
      'identity',
      actor,
      resource,
      operation,
      id,
      input,
      requestId,
      schema,
    );
  }

  catalog<T>(
    actor: PlatformPrincipal,
    resource: CatalogResource,
    operation: string,
    id: string | null,
    input: object,
    requestId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return this.call(
      'catalog',
      actor,
      resource,
      operation,
      id,
      input,
      requestId,
      schema,
    );
  }

  employeeOptions<T>(
    actor: PlatformPrincipal,
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

  private call<T>(
    kind: 'identity' | 'catalog',
    actor: PlatformPrincipal,
    resource: string,
    operation: string,
    id: string | null,
    input: object,
    requestId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    // 固定入口在每次调用中重验当前任职与权限；管理变更及成功留痕由同一数据库事务提交。
    const statement =
      kind === 'identity'
        ? 'SELECT public.platform_system_identity($1,$2,$3,$4,$5,$6::jsonb,$7) AS result'
        : 'SELECT public.platform_system_catalog($1,$2,$3,$4,$5,$6::jsonb,$7) AS result';
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
    );
  }

  private async execute<T>(
    statement: string,
    values: unknown[],
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      const result = (
        await this.runtime.pool.query<{ result: unknown }>(statement, values)
      ).rows[0].result;
      return schema.parse(result);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'P0001') {
        const parsed = ApiErrorCodeSchema.safeParse(error.message);
        if (parsed.success && statuses[parsed.data]) {
          throw new ApiException(statuses[parsed.data]!, parsed.data);
        }
      }
      throw error;
    }
  }
}
