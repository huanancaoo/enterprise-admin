import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { APIError } from 'better-auth/api';
import { AuthRuntime } from './auth-runtime';

export interface Identity {
  userId: string;
  sessionId: string;
  preferredLocale?: string | null;
}

@Injectable()
export class IdentityService {
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
    headers: Headers,
    organizationId: string,
    identity: Identity,
  ): Promise<{
    membershipId: string;
    enabled: boolean;
    defaultLocale: string;
  }> {
    try {
      // 按已验证用户过滤；不读取 active member，避免工作区偏好改变授权目标。
      const { members } = await this.runtime.auth.api.listMembers({
        headers,
        query: {
          organizationId,
          filterField: 'userId',
          filterValue: identity.userId,
          filterOperator: 'eq',
          limit: 1,
        },
      });
      const member = members[0];
      if (!member) throw new ForbiddenException();
      const organization = await this.runtime.auth.api.getFullOrganization({
        headers,
        query: { organizationId, membersLimit: 1 },
      });
      if (!organization) throw new ForbiddenException();
      return {
        membershipId: member.id,
        enabled: organization.enabled,
        defaultLocale: organization.defaultLocale,
      };
    } catch (error) {
      if (error instanceof APIError) {
        if (error.statusCode === 401) throw new UnauthorizedException();
        if (
          error.statusCode === 403 ||
          error.body?.code === 'ORGANIZATION_NOT_FOUND'
        )
          throw new ForbiddenException();
      }
      throw error;
    }
  }
}
