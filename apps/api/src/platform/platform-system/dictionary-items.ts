import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';

// 父字典是每个条目操作的必要条件，防止读取和写入脱离原有归属。
export class PlatformDictionaryItems {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('catalog', 'dictionary-item');
  }

  list(
    actor: PlatformSystemActor,
    dictionaryId: string,
    query: contracts.PlatformDictionaryItemsQuery,
    requestId: string,
  ) {
    return this.command(
      actor,
      'list',
      null,
      { ...query, dictionaryId },
      requestId,
      contracts.PlatformDictionaryItemsPageSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    dictionaryId: string,
    body: contracts.CreatePlatformDictionaryItem,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      { ...body, dictionaryId },
      requestId,
      contracts.PlatformDictionaryItemSchema,
    );
  }

  get(
    actor: PlatformSystemActor,
    dictionaryId: string,
    itemId: string,
    requestId: string,
  ) {
    return this.command(
      actor,
      'get',
      itemId,
      { dictionaryId },
      requestId,
      contracts.PlatformDictionaryItemSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    dictionaryId: string,
    itemId: string,
    body: contracts.UpdatePlatformDictionaryItem,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      itemId,
      { ...body, dictionaryId },
      requestId,
      contracts.PlatformDictionaryItemSchema,
    );
  }

  remove(
    actor: PlatformSystemActor,
    dictionaryId: string,
    itemId: string,
    requestId: string,
  ) {
    return this.command(
      actor,
      'delete',
      itemId,
      { dictionaryId },
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    dictionaryId: string,
    itemId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      itemId,
      { ...body, dictionaryId },
      requestId,
      contracts.PlatformDictionaryItemSchema,
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
      contracts.PlatformDictionaryItemsPageSchema,
      client,
    );
  }
}
