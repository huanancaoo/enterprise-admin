import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  createTenantRunner,
  type TenantContext,
  type TenantTx,
} from '@workspace/database/tenant';
import { fileRepository } from '@workspace/database/repositories/files';
import { AuthRuntime } from '../identity/auth-runtime';
import {
  IdentityService,
  businessActorReference,
} from '../identity/identity.service';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { rethrowTenantWriteError } from '../tenancy/tenant-write';
import { rethrowFileError } from './file-http-errors';

export type FileOrganizationScope = {
  tx: TenantTx;
  client: PoolClient;
  // 授权或事实读取可能等待；业务写之前再查一次数据库时钟上的会话到期。
  recheckActor: () => Promise<Date>;
};

@Injectable()
export class FileOrganizationSession {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly actors: IdentityService,
    private readonly authorization: AuthorizationService,
  ) {}

  // 身份读取不持 usage 锁。ProjectFiles 在持锁之后才读用户会话，不能走这里。
  async open<T>(
    context: TenantContext,
    headers: Headers,
    work: (scope: FileOrganizationScope) => Promise<T>,
  ): Promise<T> {
    const actor = await this.actors.requireBusinessIdentity(
      headers,
      context.organizationId,
    );
    const reference = businessActorReference(actor);
    const client = await this.runtime.pool.connect();
    try {
      return await createTenantRunner(client)(context, async (tx) => {
        await fileRepository.lockOrganization(tx);
        await fileRepository.requireCurrentActor(tx, reference);
        return work({
          tx,
          client,
          recheckActor: () => fileRepository.requireCurrentActor(tx, reference),
        });
      }).catch((error: unknown) => rethrowTenantWriteError(error, context));
    } catch (error) {
      rethrowFileError(error);
    } finally {
      client.release();
    }
  }

  // 已持有物理锁连接。身份仍在 usage 锁之前，最终授权复用这条连接。
  async authorizeHeld(
    tx: TenantTx,
    client: PoolClient,
    headers: Headers,
    permissions: PermissionRequest,
  ): Promise<Date> {
    const actor = await this.actors.requireBusinessIdentity(
      headers,
      tx.context.organizationId,
    );
    const reference = businessActorReference(actor);
    await fileRepository.lockOrganization(tx);
    await fileRepository.requireCurrentActor(tx, reference);
    await this.authorization.requirePermissionInTransaction(
      client,
      headers,
      tx.context.organizationId,
      permissions,
    );
    return fileRepository.requireCurrentActor(tx, reference);
  }
}
