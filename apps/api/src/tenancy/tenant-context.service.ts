import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { TenantContext } from '@workspace/database/tenant';
import { OrganizationIdSchema } from '@workspace/contracts';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import type { RequestLanguage } from '../http/request-language';
import { IdentityService } from '../identity/identity.service';
import { OrganizationMembershipAccess } from './organization-membership-access';

@Injectable()
export class TenantContextService {
  constructor(
    private readonly identity: IdentityService,
    private readonly authorization: AuthorizationService,
    private readonly membershipAccess: OrganizationMembershipAccess,
  ) {}

  async resolve(
    headers: Headers,
    organizationId: string,
    permissions: PermissionRequest,
    requestId: string,
    language: RequestLanguage,
  ): Promise<TenantContext> {
    const context = await this.resolveMembership(
      headers,
      organizationId,
      requestId,
      language,
      'business',
    );
    await this.authorization.requirePermission(
      headers,
      organizationId,
      permissions,
    );
    return context;
  }

  async resolveAny(
    headers: Headers,
    organizationId: string,
    alternatives: readonly PermissionRequest[],
    requestId: string,
    language: RequestLanguage,
  ): Promise<TenantContext> {
    const context = await this.resolveMembership(
      headers,
      organizationId,
      requestId,
      language,
      'business',
    );
    await this.authorization.requireAnyPermission(
      headers,
      organizationId,
      alternatives,
    );
    return context;
  }

  async resolveMembership(
    headers: Headers,
    organizationId: string,
    requestId: string,
    language: RequestLanguage,
    authentication: 'cookie' | 'business' = 'cookie',
  ): Promise<TenantContext> {
    if (!OrganizationIdSchema.safeParse(organizationId).success)
      throw new BadRequestException();
    if (authentication === 'cookie' && headers.has('x-api-key'))
      throw new UnauthorizedException();
    const actor =
      authentication === 'business'
        ? await this.identity.requireBusinessIdentity(headers, organizationId)
        : await this.identity.requireIdentity(headers);
    language.useUserPreference(actor.preferredLocale);
    const membership = await this.membershipAccess.resolve(
      actor,
      organizationId,
      requestId,
      language,
    );
    // 可信上下文只使用已验证的身份、成员和组织；请求体不能参与构造。
    return Object.freeze({
      organizationId,
      userId: actor.userId,
      membershipId: membership.membershipId,
      requestId,
      locale: language.locale,
    });
  }
}
