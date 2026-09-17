import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { OrganizationStatus } from '@workspace/contracts';
import { AuthRuntime } from './auth-runtime';
import { ApiException } from './api-exception';

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
    return {
      userId: result.user.id,
      sessionId: result.session.id,
      preferredLocale: result.user.preferredLocale,
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
    defaultLocale: string;
    status: OrganizationStatus;
    authorizationVersion: number;
  }> {
    const result = await this.runtime.pool.query<{
      membership_id: string;
      default_locale: string;
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
}
