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
export class PlatformRolesController {
  constructor(private readonly system: PlatformSystem) {}
  @Get('roles')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['sort', 'key', 'name', 'createdAt'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOperation({ operationId: 'listPlatformRoles' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformRolesPageSchema,
  })
  listPlatformRoles(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformSystemQuerySchema })
    query: contracts.PlatformSystemQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.list(actor, query, this.requestId(response));
  }

  @Post('roles')
  @ApiOperation({ operationId: 'createPlatformRole' })
  @ApiResponse({ status: 201, standardSchema: contracts.PlatformRoleSchema })
  createPlatformRole(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformRoleSchema })
    body: contracts.CreatePlatformRole,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.create(actor, body, this.requestId(response));
  }

  @Get('roles/:roleId')
  @ApiOperation({ operationId: 'getPlatformRole' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformRoleSchema })
  getPlatformRole(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.get(actor, roleId, this.requestId(response));
  }

  @Patch('roles/:roleId')
  @ApiOperation({ operationId: 'updatePlatformRole' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformRoleSchema })
  updatePlatformRole(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Body({ schema: contracts.UpdatePlatformRoleSchema })
    body: contracts.UpdatePlatformRole,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.update(
      actor,
      roleId,
      body,
      this.requestId(response),
    );
  }

  @Delete('roles/:roleId')
  @ApiOperation({ operationId: 'deletePlatformRole' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformRole(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.remove(actor, roleId, this.requestId(response));
  }

  @Patch('roles/:roleId/status')
  @ApiOperation({ operationId: 'setPlatformRoleStatus' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformRoleSchema })
  setPlatformRoleStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.setStatus(
      actor,
      roleId,
      body,
      this.requestId(response),
    );
  }

  @Patch('roles/:roleId/permissions')
  @ApiOperation({ operationId: 'setPlatformRolePermissions' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformRoleSchema })
  setPlatformRolePermissions(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Body({ schema: contracts.SetPlatformRolePermissionsSchema })
    body: contracts.SetPlatformRolePermissions,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.setPermissions(
      actor,
      roleId,
      body,
      this.requestId(response),
    );
  }

  @Get('roles/:roleId/employees')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({
    name: 'departmentId',
    required: false,
    type: String,
    format: 'uuid',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['name', 'status', 'createdAt'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiQuery({ name: 'assigned', required: true, type: Boolean })
  @ApiOperation({ operationId: 'listPlatformRoleEmployees' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformEmployeesPageSchema,
  })
  listPlatformRoleEmployees(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Query({ schema: contracts.PlatformRoleEmployeesQuerySchema })
    query: contracts.PlatformRoleEmployeesQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.employees(
      actor,
      roleId,
      query,
      this.requestId(response),
    );
  }

  @Post('roles/:roleId/employees')
  @HttpCode(200)
  @ApiOperation({ operationId: 'assignPlatformRoleEmployees' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformRoleEmployeesMutationResultSchema,
  })
  assignPlatformRoleEmployees(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Body({ schema: contracts.SetPlatformRoleEmployeesSchema })
    body: contracts.SetPlatformRoleEmployees,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.assignEmployees(
      actor,
      roleId,
      body,
      this.requestId(response),
    );
  }

  @Delete('roles/:roleId/employees')
  @ApiOperation({ operationId: 'revokePlatformRoleEmployees' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformRoleEmployeesMutationResultSchema,
  })
  revokePlatformRoleEmployees(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Body({ schema: contracts.SetPlatformRoleEmployeesSchema })
    body: contracts.SetPlatformRoleEmployees,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.roles.revokeEmployees(
      actor,
      roleId,
      body,
      this.requestId(response),
    );
  }

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
