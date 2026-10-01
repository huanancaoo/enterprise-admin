import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  OrganizationRoleAccess,
  OrganizationStatus,
} from '@workspace/contracts';
import { delegableRolePermissions } from '@workspace/permissions';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from './auth-runtime';

export interface Identity {
  userId: string;
  sessionId: string;
  preferredLocale?: string | null;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly runtime: AuthRuntime) {}

  async getIdentity(headers: Headers): Promise<Identity | null> {
    const result = await this.runtime.auth.api.getSession({
      headers,
      // 受保护业务必须读取当前会话，不能依赖 Cookie 中的身份快照。
      query: { disableCookieCache: true },
    });
    if (!result) return null;
    // Better Auth 次级存储可能仍返回数据库变更前的会话快照。
    // 会话过期或撤销以当前数据库行判断，不能以该快照授权。
    const user = await this.runtime.pool.query<{
      preferred_locale: string | null;
    }>(
      `SELECT account.preferred_locale
       FROM public."user" AS account
       INNER JOIN public.session AS active_session
         ON active_session.user_id = account.id
        AND active_session.id = $2
        AND active_session.expires_at > clock_timestamp()
       WHERE account.id = $1
       LIMIT 1`,
      [result.user.id, result.session.id],
    );
    if (!user.rows[0]) return null;
    return {
      userId: result.user.id,
      sessionId: result.session.id,
      // secondary storage 里的 user 是登录快照；界面语言以当前 user 行为准。
      preferredLocale: user.rows[0].preferred_locale,
    };
  }

  async requireIdentity(headers: Headers): Promise<Identity> {
    const identity = await this.getIdentity(headers);
    if (!identity) throw new UnauthorizedException();
    return identity;
  }

  async requireOrganizationMembership(
    organizationId: string,
    identity: Identity,
    requestId: string,
  ): Promise<{
    membershipId: string;
    defaultLocale: string | null;
    status: OrganizationStatus;
    authorizationVersion: number;
  }> {
    const result = await this.runtime.pool.query<{
      membership_id: string;
      default_locale: string | null;
      status: OrganizationStatus | null;
      authorization_version: number | null;
    }>(
      `SELECT m.id AS membership_id, o.default_locale, s.status, s.authorization_version
       FROM member m
       INNER JOIN organization o ON o.id = m.organization_id
       LEFT JOIN organization_status s ON s.organization_id = m.organization_id
       WHERE m.organization_id = $1 AND m.user_id = $2
       LIMIT 1`,
      [organizationId, identity.userId],
    );
    const membership = result.rows[0];
    if (!membership) throw new ForbiddenException();
    if (!membership.status || membership.authorization_version == null) {
      this.logger.error({
        event: 'organization.status.missing',
        organizationId,
        requestId,
      });
      throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
    }
    return {
      membershipId: membership.membership_id,
      defaultLocale: membership.default_locale,
      status: membership.status,
      authorizationVersion: membership.authorization_version,
    };
  }

  async listMembershipOrganizations(
    identity: Identity,
    requestId: string,
  ): Promise<
    {
      id: string;
      name: string;
      slug: string;
      status: OrganizationStatus;
    }[]
  > {
    const result = await this.runtime.pool.query<{
      id: string;
      name: string;
      slug: string;
      status: OrganizationStatus | null;
    }>(
      `SELECT o.id, o.name, o.slug, s.status
       FROM member m
       INNER JOIN organization o ON o.id = m.organization_id
       LEFT JOIN organization_status s ON s.organization_id = o.id
       WHERE m.user_id = $1
       ORDER BY o.created_at ASC, o.id ASC`,
      [identity.userId],
    );
    if (result.rows.some((row) => !row.status)) {
      this.logger.error({
        event: 'organization.status.missing',
        organizationId: result.rows.find((row) => !row.status)?.id,
        requestId,
      });
      throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
    }
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status!,
    }));
  }

  async readOrganizationRoleAccess(
    headers: Headers,
    organizationId: string,
  ): Promise<OrganizationRoleAccess> {
    const check = async (resource: string, action: string) => {
      const result = await this.runtime.auth.api.hasPermission({
        headers,
        body: { organizationId, permissions: { [resource]: [action] } },
      });
      return result.success;
    };
    // 固定目录合并为一次读取；判断仍交给原生授权，不复制角色策略。
    const managementActions = ['read', 'create', 'update', 'delete'] as const;
    const management = await Promise.all(
      managementActions.map((action) => check('ac', action)),
    );
    const permissions = await Promise.all(
      Object.entries(delegableRolePermissions).flatMap(([resource, actions]) =>
        actions.map(async (action) => ({
          resource,
          action,
          allowed: await check(resource, action),
        })),
      ),
    );
    return {
      canRead: management[0],
      canCreate: management[1],
      canUpdate: management[2],
      canDelete: management[3],
      grantablePermissions: permissions
        .filter((permission) => permission.allowed)
        .map(({ resource, action }) => ({ resource, action })),
    };
  }
}
