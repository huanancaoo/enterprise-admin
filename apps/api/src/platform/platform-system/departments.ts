import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';

export class PlatformDepartments {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('catalog', 'department');
  }

  list(
    actor: PlatformSystemActor,
    query: contracts.PlatformSystemTreeQuery,
    requestId: string,
  ) {
    return this.command(
      actor,
      'list',
      null,
      query,
      requestId,
      contracts.PlatformDepartmentsTreeSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformDepartment,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      body,
      requestId,
      contracts.PlatformDepartmentSchema,
    );
  }

  get(actor: PlatformSystemActor, departmentId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      departmentId,
      {},
      requestId,
      contracts.PlatformDepartmentSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    departmentId: string,
    body: contracts.UpdatePlatformDepartment,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      departmentId,
      body,
      requestId,
      contracts.PlatformDepartmentSchema,
    );
  }

  remove(actor: PlatformSystemActor, departmentId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      departmentId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    departmentId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      departmentId,
      body,
      requestId,
      contracts.PlatformDepartmentSchema,
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
      contracts.PlatformDepartmentsTreeSchema,
      client,
    );
  }
}
