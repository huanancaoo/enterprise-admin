import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  CreateProjectSchema,
  ProjectResponseSchema,
  type CreateProject,
  type ProjectResponse,
  OrganizationIdSchema,
  ProjectIdSchema,
  ProjectListQuerySchema,
  ProjectPageSchema,
  type ProjectListQuery,
  type ProjectPage,
} from '@workspace/contracts';
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { projectRepository } from '@workspace/database/repositories/projects';
import { auditRepository } from '@workspace/database/repositories/audit';
import { AuthRuntime } from './auth-runtime';
import { CurrentTenant, RequireTenant } from './tenant.guard';

@ApiTags('projects')
@Controller('organizations/:organizationId/projects')
export class ProjectsController {
  constructor(private readonly runtime: AuthRuntime) {}

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
    return createTenantRunner(this.runtime.pool)(context, async (tx) => {
      const contentLocale =
        input.contentLocale ?? (await projectRepository.defaultLocale(tx));
      const project = await projectRepository.create(tx, {
        ...input,
        contentLocale,
      });
      // 与项目和基础译文共用 TenantTx，审计失败必须回滚整个创建。
      await auditRepository.record(tx, {
        eventCode: 'project.created',
        resourceId: project.id,
        fields: { status: project.status, contentLocale },
      });
      return {
        ...project,
        name: input.name,
        description: input.description,
        resolvedLocale: contentLocale,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    });
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
    const page = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      projectRepository.listPage(tx, query),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
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
    const project = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      projectRepository.findLocalized(tx, projectId),
    );
    if (!project) throw new NotFoundException();
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
