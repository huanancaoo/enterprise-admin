import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';
import { hashPassword } from 'better-auth/crypto';

export class PlatformEmployees {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(private readonly database: PlatformSystemDatabase) {
    this.command = database.bind('identity', 'employee');
  }

  candidates(
    actor: PlatformSystemActor,
    query: contracts.PlatformEmployeeCandidatesQuery,
    requestId: string,
  ) {
    return this.command(
      actor,
      'candidates',
      null,
      query,
      requestId,
      contracts.PlatformEmployeeCandidatesPageSchema,
    );
  }

  departmentOptions(
    actor: PlatformSystemActor,
    query: contracts.PlatformEmployeeOptionsQuery,
    requestId: string,
  ) {
    return this.database.employeeOptions(
      actor,
      'department',
      query,
      requestId,
      contracts.PlatformEmployeeDepartmentOptionsPageSchema,
    );
  }

  postOptions(
    actor: PlatformSystemActor,
    query: contracts.PlatformEmployeeOptionsQuery,
    requestId: string,
  ) {
    return this.database.employeeOptions(
      actor,
      'post',
      query,
      requestId,
      contracts.PlatformEmployeePostOptionsPageSchema,
    );
  }

  roleOptions(
    actor: PlatformSystemActor,
    query: contracts.PlatformEmployeeOptionsQuery,
    requestId: string,
  ) {
    return this.database.employeeOptions(
      actor,
      'role',
      query,
      requestId,
      contracts.PlatformEmployeeRoleOptionsPageSchema,
    );
  }

  removeMany(
    actor: PlatformSystemActor,
    body: contracts.BatchRemovePlatformEmployees,
    requestId: string,
  ) {
    return this.command(
      actor,
      'batch-delete',
      null,
      body,
      requestId,
      contracts.PlatformEmployeeBatchRemoveResultSchema,
    );
  }

  list(
    actor: PlatformSystemActor,
    query: contracts.PlatformEmployeesQuery,
    requestId: string,
  ) {
    return this.command(
      actor,
      'list',
      null,
      query,
      requestId,
      contracts.PlatformEmployeesPageSchema,
    );
  }

  async create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformEmployee,
    requestId: string,
  ) {
    if (body.mode === 'existing') {
      return this.command(
        actor,
        'create',
        null,
        body,
        requestId,
        contracts.PlatformEmployeeSchema,
      );
    }
    // 初始密码只在任职创建时转换为 Better Auth 原生凭据，不进入日志或返回投影。
    const { password, ...profile } = body;
    const passwordHash = await hashPassword(password);
    return this.command(
      actor,
      'create',
      null,
      { ...profile, passwordHash },
      requestId,
      contracts.PlatformEmployeeSchema,
    );
  }

  get(actor: PlatformSystemActor, userId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      userId,
      {},
      requestId,
      contracts.PlatformEmployeeSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    userId: string,
    body: contracts.UpdatePlatformEmployee,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      userId,
      body,
      requestId,
      contracts.PlatformEmployeeSchema,
    );
  }

  remove(actor: PlatformSystemActor, userId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      userId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    userId: string,
    body: contracts.SetPlatformEmployeeStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      userId,
      body,
      requestId,
      contracts.PlatformEmployeeSchema,
    );
  }

  setRoles(
    actor: PlatformSystemActor,
    userId: string,
    body: contracts.SetPlatformEmployeeRoles,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-roles',
      userId,
      body,
      requestId,
      contracts.PlatformEmployeeSchema,
    );
  }

  exportPage(
    actor: PlatformSystemActor,
    query: PlatformSystemExportQuery,
    requestId: string,
    client: PoolClient,
  ) {
    return this.command(
      actor,
      'export-page',
      null,
      query,
      requestId,
      contracts.PlatformEmployeesPageSchema,
      client,
    );
  }
}
