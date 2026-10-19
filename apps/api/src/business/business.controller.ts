import {
  Controller,
  Get,
  Headers,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  BusinessTaskIdSchema,
  BusinessTaskPageSchema,
  BusinessTaskSchema,
  CapabilityPageQuerySchema,
  TaskCenterPageSchema,
  type CapabilityPageQuery,
} from '@workspace/contracts';
import type { TenantContext } from '@workspace/database/tenant';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import {
  CurrentTenant,
  RequireOrganizationMembership,
} from '../tenancy/tenant.guard';
import {
  BusinessTaskReadGuard,
  CurrentBusinessTaskTenant,
} from './business-task-read.guard';
import { BusinessTasks } from './business-tasks';

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
      `attachment; filename="task-${id}.${result.format}"`,
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(result.bytes);
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
