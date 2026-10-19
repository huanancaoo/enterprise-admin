import * as contracts from '@workspace/contracts';
import type { PoolClient } from 'pg';
import {
  PlatformSystemDatabase,
  type PlatformSystemActor,
  type PlatformSystemExportQuery,
} from './database';

export class PlatformPosts {
  private readonly command: ReturnType<PlatformSystemDatabase['bind']>;

  constructor(database: PlatformSystemDatabase) {
    this.command = database.bind('catalog', 'post');
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
      contracts.PlatformPostsPageSchema,
    );
  }

  create(
    actor: PlatformSystemActor,
    body: contracts.CreatePlatformPost,
    requestId: string,
  ) {
    return this.command(
      actor,
      'create',
      null,
      body,
      requestId,
      contracts.PlatformPostSchema,
    );
  }

  get(actor: PlatformSystemActor, postId: string, requestId: string) {
    return this.command(
      actor,
      'get',
      postId,
      {},
      requestId,
      contracts.PlatformPostSchema,
    );
  }

  update(
    actor: PlatformSystemActor,
    postId: string,
    body: contracts.UpdatePlatformPost,
    requestId: string,
  ) {
    return this.command(
      actor,
      'update',
      postId,
      body,
      requestId,
      contracts.PlatformPostSchema,
    );
  }

  remove(actor: PlatformSystemActor, postId: string, requestId: string) {
    return this.command(
      actor,
      'delete',
      postId,
      {},
      requestId,
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  setStatus(
    actor: PlatformSystemActor,
    postId: string,
    body: contracts.SetPlatformSystemStatus,
    requestId: string,
  ) {
    return this.command(
      actor,
      'set-status',
      postId,
      body,
      requestId,
      contracts.PlatformPostSchema,
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
      contracts.PlatformPostsPageSchema,
      client,
    );
  }
}
