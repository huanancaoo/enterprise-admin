import {
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { Response } from 'express';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  AuditEventIdSchema,
  AuditEventSchema,
  AuditEventsPageSchema,
  AuditEventsQuerySchema,
  AuditResultSchema,
  OrganizationAccessSchema,
  OrganizationIdSchema,
  OrganizationListSchema,
  OrganizationRoleAccessSchema,
  type OrganizationAccess,
  type OrganizationList,
  type OrganizationRoleAccess,
  type AuditEvent,
  type AuditEventsPage,
  type AuditEventsQuery,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { getRequestLanguage } from '../http/request-language';
import { IdentityService } from '../identity/identity.service';
import { CurrentTenant, RequireTenant } from '../tenancy/tenant.guard';
import type { TenantContext } from '@workspace/database/tenant';
import { OrganizationAuditEvents } from './audit-events';

@ApiTags('organizations')
@Controller()
export class OrganizationsController {
  constructor(
    private readonly identity: IdentityService,
    private readonly auditEvents: OrganizationAuditEvents,
  ) {}

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
    // 目标组织的偏好解析结果与 HTTP 内容协商分别返回，供界面按语言保留策略使用。
    const effective = language.preferenceResolution;
    return {
      organizationId,
      status: 'ACTIVE',
      authorizationVersion: membership.authorizationVersion,
      effectiveLocale: effective.locale,
      effectiveLocaleSource: effective.source,
    };
  }

  @Get('organizations/:organizationId/role-access')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'getOrganizationRoleAccess' })
  @ApiResponse({ status: 200, standardSchema: OrganizationRoleAccessSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async roleAccess(
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationRoleAccess> {
    const authHeaders = fromNodeHeaders(headers);
    const actor = await this.identity.requireIdentity(authHeaders);
    const membership = await this.identity.requireOrganizationMembership(
      organizationId,
      actor,
      response.locals.requestId as string,
    );
    const language = getRequestLanguage(response);
    language.useUserPreference(actor.preferredLocale);
    language.useOrganizationDefault(membership.defaultLocale);
    if (membership.status !== 'ACTIVE')
      throw new ApiException(403, 'ORGANIZATION_SUSPENDED');
    return this.identity.readOrganizationRoleAccess(
      authHeaders,
      organizationId,
    );
  }

  @Get('organizations/:organizationId/audit-events')
  @RequireTenant({ audit: ['read'] })
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'listOrganizationAuditEvents' })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'actorId', required: false, type: String })
  @ApiQuery({ name: 'eventCode', required: false, type: String })
  @ApiQuery({ name: 'resourceType', required: false, type: String })
  @ApiQuery({ name: 'resourceId', required: false, type: String })
  @ApiQuery({
    name: 'result',
    required: false,
    enum: AuditResultSchema.options,
  })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, standardSchema: AuditEventsPageSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async listAuditEvents(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Query({ schema: AuditEventsQuerySchema }) query: AuditEventsQuery,
    @CurrentTenant() context: TenantContext,
  ): Promise<AuditEventsPage> {
    return this.auditEvents.list(context, query);
  }

  @Get('organizations/:organizationId/audit-events/:eventId')
  @RequireTenant({ audit: ['read'] })
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'getOrganizationAuditEvent' })
  @ApiResponse({ status: 200, standardSchema: AuditEventSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async getAuditEvent(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('eventId', { schema: AuditEventIdSchema }) eventId: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<AuditEvent> {
    return this.auditEvents.get(context, eventId);
  }
}
