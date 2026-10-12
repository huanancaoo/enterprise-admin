import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { APIError } from 'better-auth/api';
import type { TenantContext } from '@workspace/database/tenant';
import { AccessCredentialPermissionsSchema } from '@workspace/contracts';
import type {
  CreateAccessCredential,
  IssuedAccessCredential,
  AccessCredentialList,
  AccessCredentialListQuery,
} from '@workspace/contracts';
import { permissionStatements } from '@workspace/permissions';
import { AuthRuntime } from '../identity/auth-runtime';
import { IdentityService } from '../identity/identity.service';
import { AuthorizationService } from '../authorization/authorization.service';

@Injectable()
export class AccessCredentials {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly identity: IdentityService,
    private readonly authorization: AuthorizationService,
  ) {}
  async issue(
    context: TenantContext,
    headers: Headers,
    input: CreateAccessCredential,
  ): Promise<IssuedAccessCredential> {
    const actor = await this.identity.requireIdentity(headers);
    if (actor.userId !== context.userId) throw new UnauthorizedException();
    for (const [resource, actions] of Object.entries(input.permissions)) {
      const catalog = Object.entries(permissionStatements).find(
        ([name]) => name === resource,
      )?.[1];
      if (
        !catalog ||
        actions.some((action) => !catalog.some((allowed) => allowed === action))
      )
        throw new BadRequestException();
    }
    const client = await this.runtime.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        context.organizationId,
      ]);
      await client.query('SELECT public.require_active_organization($1)', [
        context.organizationId,
      ]);
      await this.authorization.requirePermissionInTransaction(
        client,
        headers,
        context.organizationId,
        { integration: ['manage'] },
      );
      const granted = await this.runtime.auth.withDatabaseClient(client, () =>
        this.runtime.auth.api.hasPermission({
          headers,
          body: {
            organizationId: context.organizationId,
            permissions: input.permissions,
          },
        }),
      );
      if (!granted.success) throw new ForbiddenException();
      // 到期时刻来自公开输入；等待授权锁不能延长凭据有效期。
      const expiresIn = Math.floor(
        (Date.parse(input.expiresAt) - Date.now()) / 1000,
      );
      if (expiresIn <= 0) throw new BadRequestException();
      // 原生生成、哈希与 scope 落库在调用者事务中执行；绑定失败不能留下无组织凭据。
      const key = await this.runtime.auth.withDatabaseClient(client, () =>
        this.runtime.auth.credentialApi.createApiKey({
          body: {
            userId: actor.userId,
            name: input.name,
            expiresIn,
            permissions: input.permissions,
          },
        }),
      );
      await client.query(
        'INSERT INTO public.access_credentials(api_key_id,organization_id) VALUES($1,$2)',
        [key.id, context.organizationId],
      );
      await client.query(
        `INSERT INTO public.audit_events(organization_id,event_code,actor_id,resource_type,resource_id,request_id,tenant_visible,fields)
        VALUES($1,'access_credential.created',$2,'access_credential',$3,$4,true,'{}'::jsonb)`,
        [context.organizationId, actor.userId, key.id, context.requestId],
      );
      await client.query('COMMIT');
      return {
        id: key.id,
        organizationId: context.organizationId,
        userId: actor.userId,
        name: input.name,
        createdAt: key.createdAt.toISOString(),
        expiresAt: key.expiresAt!.toISOString(),
        enabled: key.enabled,
        permissions: input.permissions,
        key: key.key,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof APIError && error.statusCode === 400)
        throw new BadRequestException();
      throw error;
    } finally {
      client.release();
    }
  }
  async list(
    context: TenantContext,
    query: AccessCredentialListQuery,
  ): Promise<AccessCredentialList> {
    const client = await this.runtime.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        context.organizationId,
      ]);
      // 原生 Schema 以 UTC 无时区时间存储；不能让 pg 的宿主时区解析改变同一到期事实。

      const result = await client.query<{
        id: string | null;
        name: string;
        expires_at: string;
        created_at: string;
        enabled: boolean;
        permissions: string;
        total: number;
      }>(
        `WITH scoped AS (
           SELECT k.id,k.name,k.expires_at,k.created_at,k.enabled,k.permissions
           FROM public.apikey k JOIN public.access_credentials c ON c.api_key_id=k.id
           WHERE c.organization_id=$1 AND k.reference_id=$2
         ), page AS (
           SELECT * FROM scoped ORDER BY created_at DESC,id LIMIT $3 OFFSET $4
         ) SELECT totals.total,page.id,page.name,page.enabled,page.permissions,
           to_char(page.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
           to_char(page.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
         FROM (SELECT count(*)::int AS total FROM scoped) totals LEFT JOIN page ON true
         ORDER BY page.created_at DESC,page.id`,
        [
          context.organizationId,
          context.userId,
          query.pageSize,
          (query.page - 1) * query.pageSize,
        ],
      );
      await client.query('COMMIT');
      return {
        page: query.page,
        pageSize: query.pageSize,
        total: result.rows[0].total,
        items: result.rows.flatMap((key) =>
          key.id === null
            ? []
            : [
                {
                  id: key.id,
                  organizationId: context.organizationId,
                  userId: context.userId,
                  name: key.name,
                  expiresAt: key.expires_at,
                  createdAt: key.created_at,
                  enabled: key.enabled,
                  permissions: AccessCredentialPermissionsSchema.parse(
                    JSON.parse(key.permissions),
                  ),
                },
              ],
        ),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revoke(
    context: TenantContext,
    headers: Headers,
    id: string,
  ): Promise<void> {
    const actor = await this.identity.requireIdentity(headers);
    if (actor.userId !== context.userId) throw new UnauthorizedException();
    const client = await this.runtime.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        context.organizationId,
      ]);
      await client.query('SELECT public.require_active_organization($1)', [
        context.organizationId,
      ]);
      await this.authorization.requirePermissionInTransaction(
        client,
        headers,
        context.organizationId,
        { integration: ['manage'] },
      );
      const found = await client.query<{ id: string; enabled: boolean }>(
        'SELECT k.id,k.enabled FROM public.apikey k JOIN public.access_credentials c ON c.api_key_id=k.id WHERE k.id=$1 AND c.organization_id=$2 AND k.reference_id=$3 FOR UPDATE OF k',
        [id, context.organizationId, actor.userId],
      );
      if (!found.rowCount) throw new NotFoundException();
      if (!found.rows[0].enabled) {
        await client.query('COMMIT');
        return;
      }
      await this.runtime.auth.withDatabaseClient(client, () =>
        this.runtime.auth.credentialApi.updateApiKey({
          headers,
          body: { keyId: id, enabled: false },
        }),
      );
      await client.query(
        `INSERT INTO public.audit_events(organization_id,event_code,actor_id,resource_type,resource_id,request_id,tenant_visible,fields)
        VALUES($1,'access_credential.revoked',$2,'access_credential',$3,$4,true,'{}'::jsonb)`,
        [context.organizationId, actor.userId, id, context.requestId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
