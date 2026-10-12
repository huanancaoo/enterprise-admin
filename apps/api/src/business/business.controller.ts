import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  BusinessTaskPageSchema,
  BusinessTaskSchema,
  BusinessTaskIdSchema,
  TaskCenterPageSchema,
  CapabilityPageQuerySchema,
  CreateProjectExportSchema,
  CreateProjectImportSchema,
  type CreateProjectExport,
  type CreateProjectImport,
  type CapabilityPageQuery,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import {
  CurrentTenant,
  RequireTenant,
  RequireOrganizationMembership,
} from '../tenancy/tenant.guard';
import { BusinessTasks } from './business-tasks';
import {
  BusinessTaskReadGuard,
  CurrentBusinessTaskTenant,
} from './business-task-read.guard';

@ApiTags('Business tasks')
@ApiParam({
  name: 'organizationId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
})
@Controller('organizations/:organizationId')
export class BusinessController {
  constructor(private readonly tasks: BusinessTasks) {}
  @Get('task-center')
  @RequireOrganizationMembership()
  @ApiOperation({ operationId: 'listTaskCenter' })
  @ApiResponse({ status: 200, standardSchema: TaskCenterPageSchema })
  center(
    @CurrentTenant() context: TenantContext,
    @Query({ schema: CapabilityPageQuerySchema }) query: CapabilityPageQuery,
  ) {
    return this.tasks.center(context, query);
  }
  @Post('projects/imports')
  @HttpCode(202)
  @RequireTenant({ project: ['create'] })
  @ApiOperation({ operationId: 'createProjectImport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  import(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateProjectImportSchema }) input: CreateProjectImport,
    @Headers('idempotency-key') key: string,
  ) {
    return this.tasks.import(context, input, key);
  }
  @Get('tasks/:taskId/result')
  @UseGuards(BusinessTaskReadGuard)
  @ApiOperation({ operationId: 'getBusinessTaskResult' })
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async result(
    @CurrentBusinessTaskTenant() context: TenantContext,
    @Param('taskId', { schema: BusinessTaskIdSchema }) id: string,
    @Headers() headers: IncomingHttpHeaders,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.tasks.result(
      context,
      id,
      fromNodeHeaders(headers),
    );
    response.setHeader(
      'Content-Type',
      result.format === 'json'
        ? 'application/json'
        : result.format === 'csv'
          ? 'text/csv; charset=utf-8'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="projects-${id}.${result.format}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(result.bytes);
  }
  @Post('projects/exports')
  @HttpCode(202)
  @RequireTenant({ project: ['export'] })
  @ApiOperation({ operationId: 'createProjectExport' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: BusinessTaskSchema })
  export(
    @CurrentTenant() context: TenantContext,
    @Body({ schema: CreateProjectExportSchema }) input: CreateProjectExport,
    @Headers('idempotency-key') key: string,
  ) {
    return this.tasks.export(context, input, key);
  }
  @Get('tasks/:taskId')
  @UseGuards(BusinessTaskReadGuard)
  @ApiOperation({ operationId: 'getBusinessTask' })
  @ApiResponse({ status: 200, standardSchema: BusinessTaskSchema })
  get(
    @CurrentBusinessTaskTenant() context: TenantContext,
    @Param('taskId', { schema: BusinessTaskIdSchema }) id: string,
    @Headers() headers: IncomingHttpHeaders,
  ) {
    return this.tasks.getForRequest(context, id, fromNodeHeaders(headers));
  }
  @Get('tasks')
  @RequireOrganizationMembership()
  @ApiOperation({ operationId: 'listBusinessTasks' })
  @ApiResponse({ status: 200, standardSchema: BusinessTaskPageSchema })
  list(
    @CurrentTenant() context: TenantContext,
    @Query({ schema: CapabilityPageQuerySchema }) query: CapabilityPageQuery,
  ) {
    return this.tasks.list(context, query);
  }
}
