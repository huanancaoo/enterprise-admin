import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  CreatePlatformExportTaskSchema,
  CreatePlatformEmployeeImportTaskSchema,
  PlatformTaskSchema,
  PlatformTaskPageSchema,
  PlatformTaskQuerySchema,
  PlatformTaskIdSchema,
  type CreatePlatformExportTask,
  type CreatePlatformEmployeeImportTask,
  type PlatformTaskQuery,
} from '@workspace/contracts';
import { PLATFORM_XLSX_MEDIA_TYPE } from '@workspace/jobs/platform-exchange';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformTasks } from './platform-tasks';

@ApiTags('platform-tasks')
@Controller('platform')
@RequirePlatform()
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformTasksController {
  constructor(private readonly tasks: PlatformTasks) {}
  @Get('employees/import-template')
  @ApiOperation({ operationId: 'getPlatformEmployeeImportTemplate' })
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async template(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bytes = await this.tasks.template(actor);
    response.setHeader('Content-Type', PLATFORM_XLSX_MEDIA_TYPE);
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="platform-employees-template.xlsx"',
    );
    response.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(bytes);
  }
  @Post('employees/imports')
  @HttpCode(202)
  @ApiOperation({ operationId: 'createPlatformEmployeeImportTask' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: PlatformTaskSchema })
  import(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: CreatePlatformEmployeeImportTaskSchema })
    input: CreatePlatformEmployeeImportTask,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.tasks.import(
      actor,
      input,
      key,
      response.locals.requestId as string,
    );
  }
  @Post('exports')
  @HttpCode(202)
  @ApiOperation({ operationId: 'createPlatformExportTask' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 202, standardSchema: PlatformTaskSchema })
  export(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: CreatePlatformExportTaskSchema })
    input: CreatePlatformExportTask,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.tasks.export(
      actor,
      input,
      key,
      response.locals.requestId as string,
    );
  }
  @Get('tasks')
  @ApiOperation({ operationId: 'listPlatformTasks' })
  @ApiResponse({ status: 200, standardSchema: PlatformTaskPageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: PlatformTaskQuerySchema }) query: PlatformTaskQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.tasks.list(actor, query, response.locals.requestId as string);
  }
  @Get('tasks/:taskId')
  @ApiOperation({ operationId: 'getPlatformTask' })
  @ApiResponse({ status: 200, standardSchema: PlatformTaskSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('taskId', { schema: PlatformTaskIdSchema }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.tasks.get(actor, id, response.locals.requestId as string);
  }
  @Get('tasks/:taskId/result')
  @ApiOperation({ operationId: 'getPlatformTaskResult' })
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async result(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('taskId', { schema: PlatformTaskIdSchema }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const output = await this.tasks.result(
      actor,
      id,
      response.locals.requestId as string,
    );
    response.setHeader('Content-Type', PLATFORM_XLSX_MEDIA_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="platform-task-${id}.xlsx"`,
    );
    response.setHeader('Content-Length', output.resource.bytes);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(output.read.body);
  }
}
