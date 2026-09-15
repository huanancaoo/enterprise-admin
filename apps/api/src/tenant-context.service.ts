import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { TenantContext } from '@workspace/database/tenant';
import { OrganizationIdSchema } from '@workspace/contracts';
import type { RequestLanguage } from './request-language';
import { IdentityService } from './identity.service';
import {
  AuthorizationService,
  type PermissionRequest,
} from './authorization.service';

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
    if (!OrganizationIdSchema.safeParse(organizationId).success)
      throw new BadRequestException();
    const actor = await this.identity.requireIdentity(headers);
    language.useUserPreference(actor.preferredLocale);
    const membership = await this.identity.requireOrganizationMembership(
      headers,
      organizationId,
      actor,
    );
    language.useOrganizationDefault(membership.defaultLocale);
    if (!membership.enabled) throw new ForbiddenException();
    await this.authorization.requirePermission(
      headers,
      organizationId,
      permissions,
    );
    // 只有全部检查通过才能产生上下文；不复制请求体中的用户、成员或组织信息。
    return Object.freeze({
      organizationId,
      userId: actor.userId,
      membershipId: membership.membershipId,
      requestId,
      locale: language.locale,
    });
  }
}
