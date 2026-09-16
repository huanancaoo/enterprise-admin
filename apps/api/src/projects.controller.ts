import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
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
import {
  createTenantRunner,
  type TenantContext,
} from '@workspace/database/tenant';
import { projectRepository } from '@workspace/database/repositories/projects';
import { auditRepository } from '@workspace/database/repositories/audit';
import { AuthRuntime } from './auth-runtime';
import { AuthorizationService } from './authorization.service';
import { ProjectPolicy } from './project.policy';
import { CurrentTenant, RequireTenant, RequireTenantAny } from './tenant.guard';

@ApiTags('projects')
@Controller('organizations/:organizationId/projects')
export class ProjectsController {
  constructor(
    private readonly runtime: AuthRuntime,
    private readonly authorization: AuthorizationService,
    private readonly projectPolicy: ProjectPolicy,
  ) {}

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
    const translation = await createTenantRunner(this.runtime.pool)(
      context,
      async (tx) => {
        const project = await projectRepository.find(tx, projectId);
        if (!project) return undefined;
        const record = await projectRepository.findTranslation(
          tx,
          projectId,
          locale,
        );
        // 基础译文是数据不变量；不能把缺失基础译文误报为可新建的目标语言。
        if (!record && project.contentLocale === locale)
          throw new Error('Project base translation is missing');
        return record;
      },
    );
    if (!translation) throw new NotFoundException();
    return {
      locale: translation.locale,
      name: translation.name,
      description: translation.description,
    };
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
    // translate 只授予内容维护；一旦请求包含状态，必须在写入前重新验证 update。
    if (input.status !== undefined)
      await this.authorization.requirePermission(
        fromNodeHeaders(headers),
        context.organizationId,
        { project: ['update'] },
      );
    const project = await createTenantRunner(this.runtime.pool)(
      context,
      async (tx) => {
        const current = await this.projectPolicy.requireForMutation(
          tx,
          projectId,
        );
        let statusChanged = false;
        if (input.status !== undefined && input.status !== current.status) {
          await projectRepository.updateStatus(tx, projectId, input.status);
          statusChanged = true;
          await auditRepository.record(tx, {
            eventCode: 'project.updated',
            resourceId: projectId,
            fields: { status: input.status },
          });
        }
        if (input.translation) {
          const existing = await projectRepository.findTranslation(
            tx,
            projectId,
            input.translation.locale,
          );
          if (!existing && current.contentLocale === input.translation.locale)
            throw new Error('Project base translation is missing');
          const name = input.translation.name ?? existing?.name;
          if (!name)
            throw new BadRequestException('New translations require a name');
          const description =
            input.translation.description === undefined
              ? (existing?.description ?? null)
              : input.translation.description;
          await projectRepository.upsertTranslation(tx, {
            projectId,
            locale: input.translation.locale,
            name,
            description,
          });
          // 译文本身不带更新时间，必须触及项目才能让列表的更新时间与内容事实一致。
          if (!statusChanged) await projectRepository.touch(tx, projectId);
          await auditRepository.record(tx, {
            eventCode: 'project.translation.updated',
            resourceId: projectId,
            fields: { locale: input.translation.locale },
          });
        }
        return projectRepository.findLocalized(tx, projectId);
      },
    );
    if (!project) throw new NotFoundException();
    return {
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
