import { BadRequestException, Injectable } from '@nestjs/common';
import type { TenantContext } from '@workspace/database/tenant';
import { OrganizationIdSchema } from '@workspace/contracts';
import {
  AuthorizationService,
  type PermissionRequest,
} from '../authorization/authorization.service';
import { ApiException } from '../http/api-exception';
import type { RequestLanguage } from '../http/request-language';
import { IdentityService } from '../identity/identity.service';

@Injectable()
export class TenantContextService {
  constructor(
    private readonly identity: IdentityService,
    private readonly authorization: AuthorizationService,
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
    );
    await this.authorization.requireAnyPermission(
      headers,
      organizationId,
      alternatives,
    );
    return context;
  }

  private async resolveMembership(
    headers: Headers,
    organizationId: string,
    requestId: string,
    language: RequestLanguage,
  ): Promise<TenantContext> {
    if (!OrganizationIdSchema.safeParse(organizationId).success)
      throw new BadRequestException();
    const actor = await this.identity.requireIdentity(headers);
    language.useUserPreference(actor.preferredLocale);
    const membership = await this.identity.requireOrganizationMembership(
      organizationId,
      actor,
      requestId,
    );
    language.useOrganizationDefault(membership.defaultLocale);
    if (membership.status !== 'ACTIVE')
      throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
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
