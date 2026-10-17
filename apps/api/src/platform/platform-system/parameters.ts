import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';

export class PlatformParameters {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('catalog', 'parameter');
  }

  refresh(actor: PlatformSystemActor, requestId: string) {
    return this.command(
      actor,
      'refresh',
      null,
      {},
      requestId,
      contracts.PlatformSystemRefreshResultSchema,
    );
  }

  getByKey(actor: PlatformSystemActor, key: string, requestId: string) {
    return this.command(
      actor,
      'by-key',
      null,
      { key },
      requestId,
      contracts.PlatformParameterValueSchema,
    );
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
      contracts.PlatformParametersPageSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformParameter,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      body,
      requestId,
      contracts.PlatformParameterSchema,
    );
  }

  get(actor: PlatformSystemActor, parameterId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      parameterId,
      {},
      requestId,
      contracts.PlatformParameterSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    parameterId: string,
    body: contracts.UpdatePlatformParameter,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      parameterId,
      body,
      requestId,
      contracts.PlatformParameterSchema,
    );
  }

  remove(actor: PlatformSystemActor, parameterId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      parameterId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    parameterId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      parameterId,
      body,
      requestId,
      contracts.PlatformParameterSchema,
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
      contracts.PlatformParametersPageSchema,
      client,
    );
  }
}
