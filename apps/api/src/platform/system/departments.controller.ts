import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import * as contracts from '@workspace/contracts';
import type { Response } from 'express';
import type { PlatformPrincipal } from '../platform-access.service';
import { CurrentPlatform, RequirePlatform } from '../platform.guard';
import { PlatformSystem } from './platform-system';

@ApiTags('platform-system')
@Controller('platform')
@RequirePlatform()
@ApiResponse({ status: 400, standardSchema: contracts.ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: contracts.ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: contracts.ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: contracts.ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: contracts.ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: contracts.ApiErrorSchema })
export class PlatformDepartmentsController {
  constructor(private readonly system: PlatformSystem) {}
  @Get('departments')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'parentId', required: false, type: String, format: 'uuid' })
  @ApiOperation({ operationId: 'listPlatformDepartments' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDepartmentsTreeSchema,
  })
  listPlatformDepartments(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformSystemTreeQuerySchema })
    query: contracts.PlatformSystemTreeQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.departments.list(actor, query, this.requestId(response));
  }

  @Post('departments')
  @ApiOperation({ operationId: 'createPlatformDepartment' })
  @ApiResponse({
    status: 201,
    standardSchema: contracts.PlatformDepartmentSchema,
  })
  createPlatformDepartment(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformDepartmentSchema })
    body: contracts.CreatePlatformDepartment,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.departments.create(
      actor,
      body,
      this.requestId(response),
    );
  }

  @Get('departments/:departmentId')
  @ApiOperation({ operationId: 'getPlatformDepartment' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDepartmentSchema,
  })
  getPlatformDepartment(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('departmentId', { schema: contracts.UserIdSchema })
    departmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.departments.get(
      actor,
      departmentId,
      this.requestId(response),
    );
  }

  @Patch('departments/:departmentId')
  @ApiOperation({ operationId: 'updatePlatformDepartment' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDepartmentSchema,
  })
  updatePlatformDepartment(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('departmentId', { schema: contracts.UserIdSchema })
    departmentId: string,
    @Body({ schema: contracts.UpdatePlatformDepartmentSchema })
    body: contracts.UpdatePlatformDepartment,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.departments.update(
      actor,
      departmentId,
      body,
      this.requestId(response),
    );
  }

  @Delete('departments/:departmentId')
  @ApiOperation({ operationId: 'deletePlatformDepartment' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformDepartment(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('departmentId', { schema: contracts.UserIdSchema })
    departmentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.departments.remove(
      actor,
      departmentId,
      this.requestId(response),
    );
  }

  @Patch('departments/:departmentId/status')
  @ApiOperation({ operationId: 'setPlatformDepartmentStatus' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDepartmentSchema,
  })
  setPlatformDepartmentStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('departmentId', { schema: contracts.UserIdSchema })
    departmentId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.departments.setStatus(
      actor,
      departmentId,
      body,
      this.requestId(response),
    );
  }

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
