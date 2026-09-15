import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  OrganizationIdSchema,
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
import { AuthRuntime } from './auth-runtime';
import { CurrentTenant, RequireTenant } from './tenant.guard';

@ApiTags('projects')
@Controller('organizations/:organizationId/projects')
export class ProjectsController {
  constructor(private readonly runtime: AuthRuntime) {}

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
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProjectPage> {
    const page = await createTenantRunner(this.runtime.pool)(context, (tx) =>
      projectRepository.listPage(tx, query),
    );
    response.setHeader('Content-Language', context.locale);
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }
}
