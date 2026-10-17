import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { role, type Statements } from 'better-auth/plugins/access';
import {
  builtInOrganizationRoleKeys,
  builtInOrganizationRolePermissions,
  type PermissionRequest,
} from '@workspace/permissions';
import { AuthRuntime } from './auth-runtime';
import { AccessCredentialPermissionsSchema } from '@workspace/contracts';
import { hashAccessCredential } from '@workspace/database/auth';
import { ApiException } from '../http/api-exception';

export type CredentialIdentity = {
  userId: string;
  credentialId: string;
  preferredLocale: string | null;
};

@Injectable()
export class CredentialPrincipal {
  constructor(private readonly runtime: AuthRuntime) {}

  async authenticate(
    headers: Headers,
    organizationId: string,
    permissions?: PermissionRequest,
    ownedClient?: PoolClient,
  ): Promise<CredentialIdentity> {
    const key = headers.get('x-api-key');
    if (!key) throw new UnauthorizedException();
    const client = ownedClient ?? (await this.runtime.pool.connect());
    try {
      if (!ownedClient) await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        organizationId,
      ]);
      const lookup = await client.query<{ id: string; user_id: string }>(
        'SELECT id, reference_id AS user_id FROM public.apikey WHERE key=$1',
        [await hashAccessCredential(key)],
      );
      if (!lookup.rows[0]) throw new UnauthorizedException();
      await client.query('SELECT public.require_active_account($1::uuid)', [
        lookup.rows[0].user_id,
      ]);
      let keyId: string;
      if (ownedClient) {
        // 已持有业务/身份锁时只读取原生哈希事实；再次运行计数型 verifier 会升级行锁并造成并发互等。
        keyId = lookup.rows[0].id;
      } else {
        const checked = await this.runtime.auth.withDatabaseClient(client, () =>
          this.runtime.auth.credentialApi.verifyApiKey({ body: { key } }),
        );
        if (!checked.valid || !checked.key) throw new UnauthorizedException();
        keyId = checked.key.id;
      }
      // 原生 Key 到期列以 UTC 保存且不带时区，比较不能依赖连接的 TimeZone。
      const credential = await client.query<{
        reference_id: string;
        permissions: string | null;
        preferred_locale: string | null;
        valid: boolean;
      }>(
        `SELECT k.reference_id, k.permissions, u.preferred_locale, k.enabled AND k.expires_at > (clock_timestamp() AT TIME ZONE 'UTC') AS valid FROM public.apikey k
         JOIN public.access_credentials c ON c.api_key_id=k.id
         JOIN public."user" u ON u.id::text=k.reference_id
         WHERE k.id=$1 AND c.organization_id=$2
         FOR SHARE OF k`,
        [keyId, organizationId],
      );
      const current = credential.rows[0];
      if (!current) throw new ForbiddenException();
      if (!current.valid) throw new UnauthorizedException();
      await client.query('SELECT public.require_active_organization($1)', [
        organizationId,
      ]);
      const membership = await client.query<{
        role: string;
        permission: string | null;
      }>(
        `SELECT m.role,r.permission FROM public.member m
         LEFT JOIN public.organization_role r ON r.organization_id=m.organization_id AND r.role=m.role
         WHERE m.organization_id=$1 AND m.user_id=$2 FOR SHARE OF m`,
        [organizationId, current.reference_id],
      );
      const member = membership.rows[0];
      if (!member) throw new ForbiddenException();
      if (permissions) {
        const builtIn = builtInOrganizationRoleKeys.find(
          (key) => key === member.role,
        );
        const granted: Statements = builtIn
          ? builtInOrganizationRolePermissions[builtIn]
          : (JSON.parse(member.permission ?? '{}') as Statements);
        if (
          !role(
            AccessCredentialPermissionsSchema.parse(
              JSON.parse(current.permissions ?? '{}'),
            ),
          ).authorize(permissions).success ||
          !role(granted).authorize(permissions).success
        )
          throw new ForbiddenException();
      }
      // status/member 等锁后可能已经跨过到期时刻；以同一数据库时钟再次确认。
      const active = await client.query(
        "SELECT id FROM public.apikey WHERE id=$1 AND enabled AND expires_at > (clock_timestamp() AT TIME ZONE 'UTC')",
        [keyId],
      );
      if (!active.rowCount) throw new UnauthorizedException();
      if (!ownedClient) await client.query('COMMIT');
      return {
        userId: current.reference_id,
        credentialId: keyId,
        preferredLocale: current.preferred_locale,
      };
    } catch (error) {
      if (!ownedClient) await client.query('ROLLBACK');
      if (typeof error === 'object' && error !== null) {
        const value = error as { code?: string; message?: string };
        if (value.code === 'ORS02')
          throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
        if (value.code === 'ORS01')
          throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
        if (value.message === 'ACCOUNT_SUSPENDED')
          throw new ApiException(403, 'ACCOUNT_SUSPENDED');
        if (value.message === 'AUTHORIZATION_UNAVAILABLE')
          throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
      }
      throw error;
    } finally {
      if (!ownedClient) client.release();
    }
  }
}
