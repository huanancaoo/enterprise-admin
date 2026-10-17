import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { OrganizationStatus } from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import type { RequestLanguage } from '../http/request-language';
import { AuthRuntime } from '../identity/auth-runtime';
import type { Identity } from '../identity/identity.service';

@Injectable()
export class OrganizationMembershipAccess {
  private readonly logger = new Logger(OrganizationMembershipAccess.name);

  constructor(private readonly runtime: AuthRuntime) {}

  async resolve(
    actor: Pick<Identity, 'userId' | 'preferredLocale'>,
    organizationId: string,
    requestId: string,
    language: RequestLanguage,
  ): Promise<{ membershipId: string; authorizationVersion: number }> {
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
      [organizationId, actor.userId],
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
    // 只有成员事实完整后才使用组织语言；失败响应保留入口已验证阶段的语言。
    language.useUserPreference(actor.preferredLocale);
    language.useOrganizationDefault(membership.default_locale);
    if (membership.status !== 'ACTIVE')
      throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
    return {
      membershipId: membership.membership_id,
      authorizationVersion: membership.authorization_version,
    };
  }
}
