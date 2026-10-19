import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';
import { PlatformDictionaryItems } from './dictionary-items';

export class PlatformDictionaries {
  readonly items: PlatformDictionaryItems;
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('catalog', 'dictionary');
    this.items = new PlatformDictionaryItems(database);
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
      contracts.PlatformDictionaryValueSchema,
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
      contracts.PlatformDictionariesPageSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformDictionary,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      body,
      requestId,
      contracts.PlatformDictionarySchema,
    );
  }

  get(actor: PlatformSystemActor, dictionaryId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      dictionaryId,
      {},
      requestId,
      contracts.PlatformDictionarySchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    dictionaryId: string,
    body: contracts.UpdatePlatformDictionary,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      dictionaryId,
      body,
      requestId,
      contracts.PlatformDictionarySchema,
    );
  }

  remove(actor: PlatformSystemActor, dictionaryId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      dictionaryId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    dictionaryId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      dictionaryId,
      body,
      requestId,
      contracts.PlatformDictionarySchema,
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
      contracts.PlatformDictionariesPageSchema,
      client,
    );
  }
}
