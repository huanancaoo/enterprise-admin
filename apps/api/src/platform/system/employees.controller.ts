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
export class PlatformEmployeesController {
  constructor(private readonly system: PlatformSystem) {}
  @Get('employees/candidates')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOperation({ operationId: 'listPlatformEmployeeCandidates' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeCandidatesPageSchema,
  })
  listPlatformEmployeeCandidates(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformEmployeeCandidatesQuerySchema })
    query: contracts.PlatformEmployeeCandidatesQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.candidates(
      actor,
      query,
      this.requestId(response),
    );
  }

  @Get('employees/department-options')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'ids', required: false, type: String })
  @ApiOperation({ operationId: 'listPlatformEmployeeDepartmentOptions' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeDepartmentOptionsPageSchema,
  })
  listPlatformEmployeeDepartmentOptions(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformEmployeeOptionsQuerySchema })
    query: contracts.PlatformEmployeeOptionsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.departmentOptions(
      actor,
      query,
      this.requestId(response),
    );
  }

  @Get('employees/post-options')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'ids', required: false, type: String })
  @ApiOperation({ operationId: 'listPlatformEmployeePostOptions' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeePostOptionsPageSchema,
  })
  listPlatformEmployeePostOptions(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformEmployeeOptionsQuerySchema })
    query: contracts.PlatformEmployeeOptionsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.postOptions(
      actor,
      query,
      this.requestId(response),
    );
  }

  @Get('employees/role-options')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'ids', required: false, type: String })
  @ApiOperation({ operationId: 'listPlatformEmployeeRoleOptions' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeRoleOptionsPageSchema,
  })
  listPlatformEmployeeRoleOptions(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformEmployeeOptionsQuerySchema })
    query: contracts.PlatformEmployeeOptionsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.roleOptions(
      actor,
      query,
      this.requestId(response),
    );
  }

  @Post('employees/batch-remove')
  @HttpCode(200)
  @ApiOperation({ operationId: 'batchRemovePlatformEmployees' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeBatchRemoveResultSchema,
  })
  batchRemovePlatformEmployees(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.BatchRemovePlatformEmployeesSchema })
    body: contracts.BatchRemovePlatformEmployees,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.removeMany(
      actor,
      body,
      this.requestId(response),
    );
  }

  @Get('employees')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({
    name: 'departmentId',
    required: false,
    type: String,
    format: 'uuid',
  })
  @ApiQuery({ name: 'roleId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['name', 'status', 'createdAt'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOperation({ operationId: 'listPlatformEmployees' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeesPageSchema,
  })
  listPlatformEmployees(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformEmployeesQuerySchema })
    query: contracts.PlatformEmployeesQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.list(actor, query, this.requestId(response));
  }

  @Post('employees')
  @ApiOperation({ operationId: 'createPlatformEmployee' })
  @ApiResponse({
    status: 201,
    standardSchema: contracts.PlatformEmployeeSchema,
  })
  createPlatformEmployee(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformEmployeeSchema })
    body: contracts.CreatePlatformEmployee,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.create(actor, body, this.requestId(response));
  }

  @Get('employees/:userId')
  @ApiOperation({ operationId: 'getPlatformEmployee' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeSchema,
  })
  getPlatformEmployee(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: contracts.UserIdSchema }) userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.get(actor, userId, this.requestId(response));
  }

  @Patch('employees/:userId')
  @ApiOperation({ operationId: 'updatePlatformEmployee' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeSchema,
  })
  updatePlatformEmployee(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: contracts.UserIdSchema }) userId: string,
    @Body({ schema: contracts.UpdatePlatformEmployeeSchema })
    body: contracts.UpdatePlatformEmployee,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.update(
      actor,
      userId,
      body,
      this.requestId(response),
    );
  }

  @Delete('employees/:userId')
  @ApiOperation({ operationId: 'deletePlatformEmployee' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformEmployee(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: contracts.UserIdSchema }) userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.remove(
      actor,
      userId,
      this.requestId(response),
    );
  }

  @Patch('employees/:userId/status')
  @ApiOperation({ operationId: 'setPlatformEmployeeStatus' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeSchema,
  })
  setPlatformEmployeeStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: contracts.UserIdSchema }) userId: string,
    @Body({ schema: contracts.SetPlatformEmployeeStatusSchema })
    body: contracts.SetPlatformEmployeeStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.setStatus(
      actor,
      userId,
      body,
      this.requestId(response),
    );
  }

  @Patch('employees/:userId/roles')
  @ApiOperation({ operationId: 'setPlatformEmployeeRoles' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeeSchema,
  })
  setPlatformEmployeeRoles(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: contracts.UserIdSchema }) userId: string,
    @Body({ schema: contracts.SetPlatformEmployeeRolesSchema })
    body: contracts.SetPlatformEmployeeRoles,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.employees.setRoles(
      actor,
      userId,
      body,
      this.requestId(response),
    );
  }

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
