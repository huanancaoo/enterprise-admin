import { Body, Controller, Get, Param, Put, Headers } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { TenantContext } from '@workspace/database/tenant';
import {
  ApiErrorSchema,
  OrganizationIdSchema,
  ProjectIdSchema,
  SupportedLocaleSchema,
  ProjectAttachmentsResponseSchema,
  ProjectContentResponseSchema,
  SaveProjectContentSchema,
  type SupportedLocale,
  type SaveProjectContent,
  type ProjectAttachmentsResponse,
  type ProjectContentResponse,
} from '@workspace/contracts';
import {
  CurrentTenant,
  RequireTenant,
  RequireTenantAny,
} from '../tenancy/tenant.guard';
import { ProjectFiles } from './project-files';

@ApiTags('projects')
@Controller('organizations/:organizationId/projects')
@ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
export class ProjectFilesController {
  constructor(private readonly files: ProjectFiles) {}

  @Get(':projectId/attachments')
  @RequireTenant({ project: ['read'] })
  @ApiOperation({ operationId: 'getProjectAttachments' })
  @ApiResponse({
    status: 200,
    standardSchema: ProjectAttachmentsResponseSchema,
  })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  getAttachments(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectAttachmentsResponse> {
    return this.files.getAttachments(
      context,
      projectId,
      fromNodeHeaders(headers),
    );
  }

  @Get(':projectId/content/:locale')
  @RequireTenant({ project: ['read'] })
  @ApiOperation({ operationId: 'getProjectContent' })
  @ApiResponse({ status: 200, standardSchema: ProjectContentResponseSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  getContent(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @Param('locale', { schema: SupportedLocaleSchema }) locale: SupportedLocale,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectContentResponse> {
    return this.files.getContent(
      context,
      projectId,
      locale,
      fromNodeHeaders(headers),
    );
  }

  @Put(':projectId/content/:locale')
  @RequireTenantAny({ project: ['update'] }, { project: ['translate'] })
  @ApiOperation({ operationId: 'saveProjectContent' })
  @ApiResponse({ status: 200, standardSchema: ProjectContentResponseSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  saveContent(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @Param('locale', { schema: SupportedLocaleSchema }) locale: SupportedLocale,
    @Body({ schema: SaveProjectContentSchema }) input: SaveProjectContent,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectContentResponse> {
    return this.files.saveContent(
      context,
      projectId,
      locale,
      input,
      fromNodeHeaders(headers),
    );
  }
}
