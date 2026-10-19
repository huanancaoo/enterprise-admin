import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';

export class PlatformMenus {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('catalog', 'menu');
  }

  registry(actor: PlatformSystemActor, requestId: string) {
    return this.command(
      actor,
      'registry',
      null,
      {},
      requestId,
      contracts.PlatformMenuRegistrySchema,
    );
  }

  navigation(actor: PlatformSystemActor, requestId: string) {
    return this.command(
      actor,
      'navigation',
      null,
      {},
      requestId,
      contracts.PlatformNavigationSchema,
    );
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
      contracts.PlatformMenusTreeSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformMenu,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      body,
      requestId,
      contracts.PlatformMenuSchema,
    );
  }

  get(actor: PlatformSystemActor, menuId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      menuId,
      {},
      requestId,
      contracts.PlatformMenuSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    menuId: string,
    body: contracts.UpdatePlatformMenu,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      menuId,
      body,
      requestId,
      contracts.PlatformMenuSchema,
    );
  }

  remove(actor: PlatformSystemActor, menuId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      menuId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    menuId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      menuId,
      body,
      requestId,
      contracts.PlatformMenuSchema,
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
      contracts.PlatformMenusTreeSchema,
      client,
    );
  }
}
