import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  CreatePlatformScheduleSchema,
  UpdatePlatformScheduleSchema,
  PlatformScheduleIdSchema,
  PlatformScheduleSchema,
  PlatformSchedulePageSchema,
  PlatformScheduleQuerySchema,
  PlatformScheduleRunSchema,
  PlatformScheduleRunPageSchema,
  PlatformScheduleRunsQuerySchema,
  PlatformScheduleTypesSchema,
  DeletePlatformScheduleSchema,
  type CreatePlatformSchedule,
  type UpdatePlatformSchedule,
  type PlatformScheduleQuery,
  type PlatformScheduleRunsQuery,
} from '@workspace/contracts';
import type { PlatformPrincipal } from '../platform-access.service';
import { CurrentPlatform, RequirePlatform } from '../platform.guard';
import { PlatformSchedules } from './service';

@ApiTags('platform-schedules')
@Controller('platform/schedules')
@RequirePlatform()
export class PlatformSchedulesController {
  constructor(private readonly schedules: PlatformSchedules) {}
  @Get('types')
  @ApiOperation({ operationId: 'listPlatformScheduleTypes' })
  @ApiResponse({ status: 200, standardSchema: PlatformScheduleTypesSchema })
  types(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.types(actor, String(response.locals.requestId));
  }
  @Get()
  @ApiOperation({ operationId: 'listPlatformSchedules' })
  @ApiResponse({ status: 200, standardSchema: PlatformSchedulePageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: PlatformScheduleQuerySchema })
    query: PlatformScheduleQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.list(actor, query, String(response.locals.requestId));
  }
  @Post()
  @ApiOperation({ operationId: 'createPlatformSchedule' })
  @ApiResponse({ status: 201, standardSchema: PlatformScheduleSchema })
  create(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: CreatePlatformScheduleSchema })
    input: CreatePlatformSchedule,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.create(
      actor,
      input,
      String(response.locals.requestId),
    );
  }
  @Get(':scheduleId')
  @ApiOperation({ operationId: 'getPlatformSchedule' })
  @ApiResponse({ status: 200, standardSchema: PlatformScheduleSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('scheduleId', { schema: PlatformScheduleIdSchema }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.get(actor, id, String(response.locals.requestId));
  }
  @Patch(':scheduleId')
  @ApiOperation({ operationId: 'updatePlatformSchedule' })
  @ApiResponse({ status: 200, standardSchema: PlatformScheduleSchema })
  update(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('scheduleId', { schema: PlatformScheduleIdSchema }) id: string,
    @Body({ schema: UpdatePlatformScheduleSchema })
    input: UpdatePlatformSchedule,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.update(
      actor,
      id,
      input,
      String(response.locals.requestId),
    );
  }
  @Delete(':scheduleId')
  @ApiOperation({ operationId: 'deletePlatformSchedule' })
  @ApiResponse({ status: 200, standardSchema: DeletePlatformScheduleSchema })
  delete(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('scheduleId', { schema: PlatformScheduleIdSchema }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.delete(actor, id, String(response.locals.requestId));
  }
  @Post(':scheduleId/runs')
  @HttpCode(202)
  @ApiOperation({ operationId: 'runPlatformSchedule' })
  @ApiResponse({ status: 202, standardSchema: PlatformScheduleRunSchema })
  run(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('scheduleId', { schema: PlatformScheduleIdSchema }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.run(actor, id, String(response.locals.requestId));
  }
  @Get(':scheduleId/runs')
  @ApiOperation({ operationId: 'listPlatformScheduleRuns' })
  @ApiResponse({ status: 200, standardSchema: PlatformScheduleRunPageSchema })
  runs(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('scheduleId', { schema: PlatformScheduleIdSchema }) id: string,
    @Query({ schema: PlatformScheduleRunsQuerySchema })
    query: PlatformScheduleRunsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.schedules.runs(
      actor,
      id,
      query,
      String(response.locals.requestId),
    );
  }
}
