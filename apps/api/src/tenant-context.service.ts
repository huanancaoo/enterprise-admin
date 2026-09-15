import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { TenantContext } from '@workspace/database/tenant';
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
    locale: TenantContext['locale'],
  ): Promise<TenantContext> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        organizationId,
      )
    )
      throw new BadRequestException('organizationId must be a UUID v4');
    const actor = await this.identity.requireIdentity(headers);
    const membership = await this.identity.requireOrganizationMembership(
      headers,
      organizationId,
      actor,
    );
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
      locale,
    });
  }
}
