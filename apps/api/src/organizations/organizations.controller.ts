import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  OrganizationAccessSchema,
  OrganizationIdSchema,
  OrganizationListSchema,
  type OrganizationAccess,
  type OrganizationList,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { getRequestLanguage } from '../http/request-language';
import { IdentityService } from '../identity/identity.service';

@ApiTags('organizations')
@Controller()
export class OrganizationsController {
  constructor(private readonly identity: IdentityService) {}

  @Get('me/organizations')
  @ApiOperation({ operationId: 'listMyOrganizations' })
  @ApiResponse({ status: 200, standardSchema: OrganizationListSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async listMine(
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationList> {
    const actor = await this.identity.requireIdentity(fromNodeHeaders(headers));
    getRequestLanguage(response).useUserPreference(actor.preferredLocale);
    return this.identity.listMembershipOrganizations(
      actor,
      response.locals.requestId as string,
    );
  }

  @Get('organizations/:organizationId/access')
  @ApiOperation({ operationId: 'getOrganizationAccess' })
  @ApiResponse({ status: 200, standardSchema: OrganizationAccessSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async access(
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationAccess> {
    const language = getRequestLanguage(response);
    const actor = await this.identity.requireIdentity(fromNodeHeaders(headers));
    language.useUserPreference(actor.preferredLocale);
    const membership = await this.identity.requireOrganizationMembership(
      organizationId,
      actor,
      response.locals.requestId as string,
    );
    language.useOrganizationDefault(membership.defaultLocale);
    if (membership.status !== 'ACTIVE')
      throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
    // API 请求头仍协商响应语言；页面上下文按用户与目标组织设置重新计算，便于切组织后更新 UI。
    const effective = language.preferenceResolution;
    return {
      organizationId,
      status: 'ACTIVE',
      authorizationVersion: membership.authorizationVersion,
      effectiveLocale: effective.locale,
      effectiveLocaleSource: effective.source,
    };
  }
}
