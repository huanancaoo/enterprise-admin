import { Controller, Get, Header, Headers, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ApiErrorSchema,
  OrganizationIdSchema,
  OrganizationRoleDirectoryQuerySchema,
  OrganizationRoleDirectoryPageSchema,
  OrganizationInvitationDirectoryQuerySchema,
  OrganizationInvitationDirectoryPageSchema,
  type OrganizationRoleDirectoryQuery,
  type OrganizationRoleDirectoryPage,
  type OrganizationInvitationDirectoryQuery,
  type OrganizationInvitationDirectoryPage,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireOrganizationMembership,
} from '../tenancy/tenant.guard';
import { OrganizationDirectories } from './organization-directories';

@ApiTags('organization-directories')
@Controller('organizations/:organizationId')
@RequireOrganizationMembership()
export class OrganizationDirectoriesController {
  constructor(private readonly directories: OrganizationDirectories) {}

  @Get('roles-directory')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'listOrganizationRoleDirectory' })
  @ApiResponse({
    status: 200,
    standardSchema: OrganizationRoleDirectoryPageSchema,
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  async roles(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Query({ schema: OrganizationRoleDirectoryQuerySchema })
    query: OrganizationRoleDirectoryQuery,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<OrganizationRoleDirectoryPage> {
    return this.directories.roles(context, fromNodeHeaders(headers), query);
  }

  @Get('invitations-directory')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ operationId: 'listOrganizationInvitationDirectory' })
  @ApiResponse({
    status: 200,
    standardSchema: OrganizationInvitationDirectoryPageSchema,
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  async invitations(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Query({ schema: OrganizationInvitationDirectoryQuerySchema })
    query: OrganizationInvitationDirectoryQuery,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<OrganizationInvitationDirectoryPage> {
    return this.directories.invitations(
      context,
      fromNodeHeaders(headers),
      query,
    );
  }
}
