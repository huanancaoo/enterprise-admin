import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectResponseSchema,
  ProjectTranslationResponseSchema,
  type CreateProject,
  type UpdateProject,
  type ProjectResponse,
  type ProjectTranslationResponse,
  OrganizationIdSchema,
  ProjectIdSchema,
  SupportedLocaleSchema,
  type SupportedLocale,
  ProjectListQuerySchema,
  ProjectPageSchema,
  type ProjectListQuery,
  type ProjectPage,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { Projects } from './projects';
import { CurrentTenant, RequireTenant, RequireTenantAny } from './tenant.guard';

@ApiTags('projects')
@Controller('organizations/:organizationId/projects')
export class ProjectsController {
  constructor(private readonly projects: Projects) {}

  @Post()
  @RequireTenant({ project: ['create'] })
  @ApiOperation({ operationId: 'createProject' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 201, standardSchema: ProjectResponseSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async create(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Body({ schema: CreateProjectSchema }) input: CreateProject,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectResponse> {
    return this.projects.create(context, input);
  }

  @Get()
  @RequireTenant({ project: ['read'] })
  @ApiOperation({ operationId: 'listProjects' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    schema: { type: 'string' },
    description: 'Supported language preference: zh-CN, en-US, ar',
  })
  @ApiResponse({ status: 200, standardSchema: ProjectPageSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async list(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Query({ schema: ProjectListQuerySchema }) query: ProjectListQuery,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectPage> {
    return this.projects.list(context, query);
  }

  @Get(':projectId')
  @RequireTenant({ project: ['read'] })
  @ApiOperation({ operationId: 'getProject' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    schema: { type: 'string' },
    description: 'Supported language preference: zh-CN, en-US, ar',
  })
  @ApiResponse({ status: 200, standardSchema: ProjectResponseSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async get(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectResponse> {
    return this.projects.get(context, projectId);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireTenant({ project: ['delete'] })
  @ApiOperation({ operationId: 'deleteProject' })
  @ApiResponse({ status: 204, description: 'Project deleted' })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async delete(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @CurrentTenant() context: TenantContext,
  ): Promise<void> {
    return this.projects.delete(context, projectId);
  }

  @Get(':projectId/translations/:locale')
  @RequireTenantAny({ project: ['update'] }, { project: ['translate'] })
  @ApiOperation({ operationId: 'getProjectTranslation' })
  @ApiResponse({
    status: 200,
    standardSchema: ProjectTranslationResponseSchema,
  })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async getTranslation(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @Param('locale', { schema: SupportedLocaleSchema }) locale: SupportedLocale,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectTranslationResponse> {
    return this.projects.getTranslation(context, projectId, locale);
  }

  @Patch(':projectId')
  @RequireTenantAny({ project: ['update'] }, { project: ['translate'] })
  @ApiOperation({ operationId: 'updateProject' })
  @ApiHeader({
    name: 'Accept-Language',
    required: false,
    schema: { type: 'string' },
    description: 'Supported language preference: zh-CN, en-US, ar',
  })
  @ApiResponse({ status: 200, standardSchema: ProjectResponseSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  async update(
    @Param('organizationId', { schema: OrganizationIdSchema })
    _organizationId: string,
    @Param('projectId', { schema: ProjectIdSchema }) projectId: string,
    @Body({ schema: UpdateProjectSchema }) input: UpdateProject,
    @Headers() headers: IncomingHttpHeaders,
    @CurrentTenant() context: TenantContext,
  ): Promise<ProjectResponse> {
    return this.projects.update(
      context,
      projectId,
      input,
      fromNodeHeaders(headers),
    );
  }
}
