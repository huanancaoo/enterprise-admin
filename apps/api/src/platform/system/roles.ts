import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';

export class PlatformRoles {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('identity', 'role');
  }

  list(
    actor: PlatformSystemActor,
    query: contracts.PlatformSystemQuery,
    requestId: string,
  ) {
    return this.command(
      actor,
      'list',
      null,
      query,
      requestId,
      contracts.PlatformRolesPageSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformRole,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      body,
      requestId,
      contracts.PlatformRoleSchema,
    );
  }

  get(actor: PlatformSystemActor, roleId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      roleId,
      {},
      requestId,
      contracts.PlatformRoleSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    roleId: string,
    body: contracts.UpdatePlatformRole,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      roleId,
      body,
      requestId,
      contracts.PlatformRoleSchema,
    );
  }

  remove(actor: PlatformSystemActor, roleId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      roleId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    roleId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      roleId,
      body,
      requestId,
      contracts.PlatformRoleSchema,
    );
  }

  setPermissions(
    actor: PlatformSystemActor,
    roleId: string,
    body: contracts.SetPlatformRolePermissions,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-permissions',
      roleId,
      body,
      requestId,
      contracts.PlatformRoleSchema,
    );
  }

  employees(
    actor: PlatformSystemActor,
    roleId: string,
    query: contracts.PlatformRoleEmployeesQuery,
    requestId: string,
  ) {
    return this.command(
      actor,
      'employees',
      roleId,
      query,
      requestId,
      contracts.PlatformEmployeesPageSchema,
    );
  }

  assignEmployees(
    actor: PlatformSystemActor,
    roleId: string,
    body: contracts.SetPlatformRoleEmployees,
    requestId: string,
  ) {
    return this.command(
      actor,
      'assign-employees',
      roleId,
      body,
      requestId,
      contracts.PlatformRoleEmployeesMutationResultSchema,
    );
  }

  revokeEmployees(
    actor: PlatformSystemActor,
    roleId: string,
    body: contracts.SetPlatformRoleEmployees,
    requestId: string,
  ) {
    return this.command(
      actor,
      'revoke-employees',
      roleId,
      body,
      requestId,
      contracts.PlatformRoleEmployeesMutationResultSchema,
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
      contracts.PlatformRolesPageSchema,
      client,
    );
  }
}
