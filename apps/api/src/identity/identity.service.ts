import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type {
  OrganizationRoleAccess,
  OrganizationStatus,
} from '@workspace/contracts';
import { delegableRolePermissions } from '@workspace/permissions';
import { ApiException } from '../http/api-exception';
import { AuthRuntime } from './auth-runtime';
import {
  CredentialPrincipal,
  type CredentialIdentity,
} from './credential-principal';

export interface Identity {
  userId: string;
  sessionId: string;
  preferredLocale?: string | null;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly runtime: AuthRuntime,
    private readonly credentials: CredentialPrincipal,
  ) {}

  requireBusinessIdentity(
    headers: Headers,
    organizationId: string,
  ): Promise<Identity | CredentialIdentity> {
    return headers.has('x-api-key')
      ? this.credentials.authenticate(headers, organizationId)
      : this.requireIdentity(headers);
  }

  async getIdentity(headers: Headers): Promise<Identity | null> {
    const result = await this.runtime.auth.api.getSession({
      headers,
      // 受保护业务必须读取当前会话，不能依赖 Cookie 中的身份快照。
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!result) return null;
    try {
      // 原生会话读取与业务入口检查是两个时点；共享判定规则，不复用此前的授权快照。
      const user = await this.runtime.auth.sessionFacts.readCurrentUser(
        result.user.id,
        result.session.id,
      );
      if (!user) return null;
      return {
        userId: result.user.id,
        sessionId: result.session.id,
        preferredLocale: user.preferred_locale,
      };
    } catch (error) {
      const value = error as { message?: string };
      if (value.message === 'ACCOUNT_SUSPENDED')
        throw new ApiException(403, 'ACCOUNT_SUSPENDED');
      if (value.message === 'AUTHORIZATION_UNAVAILABLE')
        throw new ApiException(503, 'AUTHORIZATION_UNAVAILABLE');
      throw error;
    }
  }

  async requireIdentity(headers: Headers): Promise<Identity> {
    const identity = await this.getIdentity(headers);
    if (!identity) throw new UnauthorizedException();
    return identity;
  }

  async listMembershipOrganizations(
    identity: Pick<Identity, 'userId'>,
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

export function businessActorReference(
  actor: Identity | CredentialIdentity,
): string | { credentialId: string } {
  return 'credentialId' in actor
    ? { credentialId: actor.credentialId }
    : actor.sessionId;
}
