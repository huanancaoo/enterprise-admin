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
import type { Response } from 'express';
import * as contracts from '@workspace/contracts';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
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
export class PlatformSystemController {
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
    return this.system.identity(
      actor,
      'employee',
      'candidates',
      null,
      query,
      this.requestId(response),
      contracts.PlatformEmployeeCandidatesPageSchema,
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
    return this.system.employeeOptions(
      actor,
      'department',
      query,
      this.requestId(response),
      contracts.PlatformEmployeeDepartmentOptionsPageSchema,
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
    return this.system.employeeOptions(
      actor,
      'post',
      query,
      this.requestId(response),
      contracts.PlatformEmployeePostOptionsPageSchema,
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
    return this.system.employeeOptions(
      actor,
      'role',
      query,
      this.requestId(response),
      contracts.PlatformEmployeeRoleOptionsPageSchema,
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
    return this.system.identity(
      actor,
      'employee',
      'batch-delete',
      null,
      body,
      this.requestId(response),
      contracts.PlatformEmployeeBatchRemoveResultSchema,
    );
  }

  @Get('menus/registry')
  @ApiOperation({ operationId: 'getPlatformMenuRegistry' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformMenuRegistrySchema,
  })
  getPlatformMenuRegistry(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'registry',
      null,
      {},
      this.requestId(response),
      contracts.PlatformMenuRegistrySchema,
    );
  }

  @Get('navigation')
  @ApiOperation({ operationId: 'listPlatformNavigation' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformNavigationSchema,
  })
  listPlatformNavigation(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'navigation',
      null,
      {},
      this.requestId(response),
      contracts.PlatformNavigationSchema,
    );
  }

  @Post('dictionaries/cache/refresh')
  @HttpCode(200)
  @ApiOperation({ operationId: 'refreshPlatformDictionaryCache' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemRefreshResultSchema,
  })
  refreshPlatformDictionaryCache(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'refresh',
      null,
      {},
      this.requestId(response),
      contracts.PlatformSystemRefreshResultSchema,
    );
  }

  @Get('dictionaries/by-key/:key')
  @ApiOperation({ operationId: 'getPlatformDictionaryByKey' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionaryValueSchema,
  })
  getPlatformDictionaryByKey(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('key', { schema: contracts.PlatformSystemKeySchema }) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'by-key',
      null,
      { key },
      this.requestId(response),
      contracts.PlatformDictionaryValueSchema,
    );
  }

  @Post('parameters/cache/refresh')
  @HttpCode(200)
  @ApiOperation({ operationId: 'refreshPlatformParameterCache' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemRefreshResultSchema,
  })
  refreshPlatformParameterCache(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'refresh',
      null,
      {},
      this.requestId(response),
      contracts.PlatformSystemRefreshResultSchema,
    );
  }

  @Get('parameters/by-key/:key')
  @ApiOperation({ operationId: 'getPlatformParameterByKey' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformParameterValueSchema,
  })
  getPlatformParameterByKey(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('key', { schema: contracts.PlatformSystemKeySchema }) key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'by-key',
      null,
      { key },
      this.requestId(response),
      contracts.PlatformParameterValueSchema,
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
    return this.system.identity(
      actor,
      'employee',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformEmployeesPageSchema,
    );
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
    return this.system.createEmployee(actor, body, this.requestId(response));
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
    return this.system.identity(
      actor,
      'employee',
      'get',
      userId,
      {},
      this.requestId(response),
      contracts.PlatformEmployeeSchema,
    );
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
    return this.system.identity(
      actor,
      'employee',
      'update',
      userId,
      body,
      this.requestId(response),
      contracts.PlatformEmployeeSchema,
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
    return this.system.identity(
      actor,
      'employee',
      'delete',
      userId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
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
    return this.system.identity(
      actor,
      'employee',
      'set-status',
      userId,
      body,
      this.requestId(response),
      contracts.PlatformEmployeeSchema,
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
    return this.system.identity(
      actor,
      'employee',
      'set-roles',
      userId,
      body,
      this.requestId(response),
      contracts.PlatformEmployeeSchema,
    );
  }

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
    return this.system.identity(
      actor,
      'role',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformRolesPageSchema,
    );
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
    return this.system.identity(
      actor,
      'role',
      'create',
      null,
      body,
      this.requestId(response),
      contracts.PlatformRoleSchema,
    );
  }

  @Get('roles/:roleId')
  @ApiOperation({ operationId: 'getPlatformRole' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformRoleSchema })
  getPlatformRole(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('roleId', { schema: contracts.UserIdSchema }) roleId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.identity(
      actor,
      'role',
      'get',
      roleId,
      {},
      this.requestId(response),
      contracts.PlatformRoleSchema,
    );
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
    return this.system.identity(
      actor,
      'role',
      'update',
      roleId,
      body,
      this.requestId(response),
      contracts.PlatformRoleSchema,
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
    return this.system.identity(
      actor,
      'role',
      'delete',
      roleId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
    );
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
    return this.system.identity(
      actor,
      'role',
      'set-status',
      roleId,
      body,
      this.requestId(response),
      contracts.PlatformRoleSchema,
    );
  }

  @Get('menus')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'parentId', required: false, type: String, format: 'uuid' })
  @ApiOperation({ operationId: 'listPlatformMenus' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformMenusTreeSchema,
  })
  listPlatformMenus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformSystemTreeQuerySchema })
    query: contracts.PlatformSystemTreeQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformMenusTreeSchema,
    );
  }

  @Post('menus')
  @ApiOperation({ operationId: 'createPlatformMenu' })
  @ApiResponse({ status: 201, standardSchema: contracts.PlatformMenuSchema })
  createPlatformMenu(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformMenuSchema })
    body: contracts.CreatePlatformMenu,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'create',
      null,
      body,
      this.requestId(response),
      contracts.PlatformMenuSchema,
    );
  }

  @Get('menus/:menuId')
  @ApiOperation({ operationId: 'getPlatformMenu' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformMenuSchema })
  getPlatformMenu(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('menuId', { schema: contracts.UserIdSchema }) menuId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'get',
      menuId,
      {},
      this.requestId(response),
      contracts.PlatformMenuSchema,
    );
  }

  @Patch('menus/:menuId')
  @ApiOperation({ operationId: 'updatePlatformMenu' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformMenuSchema })
  updatePlatformMenu(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('menuId', { schema: contracts.UserIdSchema }) menuId: string,
    @Body({ schema: contracts.UpdatePlatformMenuSchema })
    body: contracts.UpdatePlatformMenu,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'update',
      menuId,
      body,
      this.requestId(response),
      contracts.PlatformMenuSchema,
    );
  }

  @Delete('menus/:menuId')
  @ApiOperation({ operationId: 'deletePlatformMenu' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformMenu(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('menuId', { schema: contracts.UserIdSchema }) menuId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'delete',
      menuId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  @Patch('menus/:menuId/status')
  @ApiOperation({ operationId: 'setPlatformMenuStatus' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformMenuSchema })
  setPlatformMenuStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('menuId', { schema: contracts.UserIdSchema }) menuId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'menu',
      'set-status',
      menuId,
      body,
      this.requestId(response),
      contracts.PlatformMenuSchema,
    );
  }

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
    return this.system.catalog(
      actor,
      'department',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformDepartmentsTreeSchema,
    );
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
    return this.system.catalog(
      actor,
      'department',
      'create',
      null,
      body,
      this.requestId(response),
      contracts.PlatformDepartmentSchema,
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
    return this.system.catalog(
      actor,
      'department',
      'get',
      departmentId,
      {},
      this.requestId(response),
      contracts.PlatformDepartmentSchema,
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
    return this.system.catalog(
      actor,
      'department',
      'update',
      departmentId,
      body,
      this.requestId(response),
      contracts.PlatformDepartmentSchema,
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
    return this.system.catalog(
      actor,
      'department',
      'delete',
      departmentId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
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
    return this.system.catalog(
      actor,
      'department',
      'set-status',
      departmentId,
      body,
      this.requestId(response),
      contracts.PlatformDepartmentSchema,
    );
  }

  @Get('posts')
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
  @ApiOperation({ operationId: 'listPlatformPosts' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformPostsPageSchema,
  })
  listPlatformPosts(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformSystemQuerySchema })
    query: contracts.PlatformSystemQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'post',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformPostsPageSchema,
    );
  }

  @Post('posts')
  @ApiOperation({ operationId: 'createPlatformPost' })
  @ApiResponse({ status: 201, standardSchema: contracts.PlatformPostSchema })
  createPlatformPost(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformPostSchema })
    body: contracts.CreatePlatformPost,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'post',
      'create',
      null,
      body,
      this.requestId(response),
      contracts.PlatformPostSchema,
    );
  }

  @Get('posts/:postId')
  @ApiOperation({ operationId: 'getPlatformPost' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformPostSchema })
  getPlatformPost(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('postId', { schema: contracts.UserIdSchema }) postId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'post',
      'get',
      postId,
      {},
      this.requestId(response),
      contracts.PlatformPostSchema,
    );
  }

  @Patch('posts/:postId')
  @ApiOperation({ operationId: 'updatePlatformPost' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformPostSchema })
  updatePlatformPost(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('postId', { schema: contracts.UserIdSchema }) postId: string,
    @Body({ schema: contracts.UpdatePlatformPostSchema })
    body: contracts.UpdatePlatformPost,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'post',
      'update',
      postId,
      body,
      this.requestId(response),
      contracts.PlatformPostSchema,
    );
  }

  @Delete('posts/:postId')
  @ApiOperation({ operationId: 'deletePlatformPost' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformPost(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('postId', { schema: contracts.UserIdSchema }) postId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'post',
      'delete',
      postId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  @Patch('posts/:postId/status')
  @ApiOperation({ operationId: 'setPlatformPostStatus' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformPostSchema })
  setPlatformPostStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('postId', { schema: contracts.UserIdSchema }) postId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'post',
      'set-status',
      postId,
      body,
      this.requestId(response),
      contracts.PlatformPostSchema,
    );
  }

  @Get('dictionaries')
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
  @ApiOperation({ operationId: 'listPlatformDictionaries' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionariesPageSchema,
  })
  listPlatformDictionaries(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformSystemQuerySchema })
    query: contracts.PlatformSystemQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformDictionariesPageSchema,
    );
  }

  @Post('dictionaries')
  @ApiOperation({ operationId: 'createPlatformDictionary' })
  @ApiResponse({
    status: 201,
    standardSchema: contracts.PlatformDictionarySchema,
  })
  createPlatformDictionary(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformDictionarySchema })
    body: contracts.CreatePlatformDictionary,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'create',
      null,
      body,
      this.requestId(response),
      contracts.PlatformDictionarySchema,
    );
  }

  @Get('dictionaries/:dictionaryId')
  @ApiOperation({ operationId: 'getPlatformDictionary' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionarySchema,
  })
  getPlatformDictionary(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'get',
      dictionaryId,
      {},
      this.requestId(response),
      contracts.PlatformDictionarySchema,
    );
  }

  @Patch('dictionaries/:dictionaryId')
  @ApiOperation({ operationId: 'updatePlatformDictionary' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionarySchema,
  })
  updatePlatformDictionary(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Body({ schema: contracts.UpdatePlatformDictionarySchema })
    body: contracts.UpdatePlatformDictionary,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'update',
      dictionaryId,
      body,
      this.requestId(response),
      contracts.PlatformDictionarySchema,
    );
  }

  @Delete('dictionaries/:dictionaryId')
  @ApiOperation({ operationId: 'deletePlatformDictionary' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformDictionary(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'delete',
      dictionaryId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  @Patch('dictionaries/:dictionaryId/status')
  @ApiOperation({ operationId: 'setPlatformDictionaryStatus' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionarySchema,
  })
  setPlatformDictionaryStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary',
      'set-status',
      dictionaryId,
      body,
      this.requestId(response),
      contracts.PlatformDictionarySchema,
    );
  }

  @Get('parameters')
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
  @ApiOperation({ operationId: 'listPlatformParameters' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformParametersPageSchema,
  })
  listPlatformParameters(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: contracts.PlatformSystemQuerySchema })
    query: contracts.PlatformSystemQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'list',
      null,
      query,
      this.requestId(response),
      contracts.PlatformParametersPageSchema,
    );
  }

  @Post('parameters')
  @ApiOperation({ operationId: 'createPlatformParameter' })
  @ApiResponse({
    status: 201,
    standardSchema: contracts.PlatformParameterSchema,
  })
  createPlatformParameter(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: contracts.CreatePlatformParameterSchema })
    body: contracts.CreatePlatformParameter,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'create',
      null,
      body,
      this.requestId(response),
      contracts.PlatformParameterSchema,
    );
  }

  @Get('parameters/:parameterId')
  @ApiOperation({ operationId: 'getPlatformParameter' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformParameterSchema,
  })
  getPlatformParameter(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('parameterId', { schema: contracts.UserIdSchema })
    parameterId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'get',
      parameterId,
      {},
      this.requestId(response),
      contracts.PlatformParameterSchema,
    );
  }

  @Patch('parameters/:parameterId')
  @ApiOperation({ operationId: 'updatePlatformParameter' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformParameterSchema,
  })
  updatePlatformParameter(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('parameterId', { schema: contracts.UserIdSchema })
    parameterId: string,
    @Body({ schema: contracts.UpdatePlatformParameterSchema })
    body: contracts.UpdatePlatformParameter,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'update',
      parameterId,
      body,
      this.requestId(response),
      contracts.PlatformParameterSchema,
    );
  }

  @Delete('parameters/:parameterId')
  @ApiOperation({ operationId: 'deletePlatformParameter' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformParameter(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('parameterId', { schema: contracts.UserIdSchema })
    parameterId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'delete',
      parameterId,
      {},
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  @Patch('parameters/:parameterId/status')
  @ApiOperation({ operationId: 'setPlatformParameterStatus' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformParameterSchema,
  })
  setPlatformParameterStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('parameterId', { schema: contracts.UserIdSchema })
    parameterId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'parameter',
      'set-status',
      parameterId,
      body,
      this.requestId(response),
      contracts.PlatformParameterSchema,
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
    return this.system.identity(
      actor,
      'role',
      'set-permissions',
      roleId,
      body,
      this.requestId(response),
      contracts.PlatformRoleSchema,
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
    return this.system.identity(
      actor,
      'role',
      'employees',
      roleId,
      query,
      this.requestId(response),
      contracts.PlatformEmployeesPageSchema,
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
    return this.system.identity(
      actor,
      'role',
      'assign-employees',
      roleId,
      body,
      this.requestId(response),
      contracts.PlatformRoleEmployeesMutationResultSchema,
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
    return this.system.identity(
      actor,
      'role',
      'revoke-employees',
      roleId,
      body,
      this.requestId(response),
      contracts.PlatformRoleEmployeesMutationResultSchema,
    );
  }

  @Get('dictionaries/:dictionaryId/items')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: ['active', 'disabled'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['sort', 'value', 'label', 'createdAt'],
  })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['asc', 'desc'] })
  @ApiOperation({ operationId: 'listPlatformDictionaryItems' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionaryItemsPageSchema,
  })
  listPlatformDictionaryItems(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Query({ schema: contracts.PlatformDictionaryItemsQuerySchema })
    query: contracts.PlatformDictionaryItemsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary-item',
      'list',
      null,
      { ...query, dictionaryId },
      this.requestId(response),
      contracts.PlatformDictionaryItemsPageSchema,
    );
  }

  @Post('dictionaries/:dictionaryId/items')
  @ApiOperation({ operationId: 'createPlatformDictionaryItem' })
  @ApiResponse({
    status: 201,
    standardSchema: contracts.PlatformDictionaryItemSchema,
  })
  createPlatformDictionaryItem(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Body({ schema: contracts.CreatePlatformDictionaryItemSchema })
    body: contracts.CreatePlatformDictionaryItem,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary-item',
      'create',
      null,
      { ...body, dictionaryId },
      this.requestId(response),
      contracts.PlatformDictionaryItemSchema,
    );
  }

  @Get('dictionaries/:dictionaryId/items/:itemId')
  @ApiOperation({ operationId: 'getPlatformDictionaryItem' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionaryItemSchema,
  })
  getPlatformDictionaryItem(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Param('itemId', { schema: contracts.UserIdSchema }) itemId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary-item',
      'get',
      itemId,
      { dictionaryId },
      this.requestId(response),
      contracts.PlatformDictionaryItemSchema,
    );
  }

  @Patch('dictionaries/:dictionaryId/items/:itemId')
  @ApiOperation({ operationId: 'updatePlatformDictionaryItem' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionaryItemSchema,
  })
  updatePlatformDictionaryItem(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Param('itemId', { schema: contracts.UserIdSchema }) itemId: string,
    @Body({ schema: contracts.UpdatePlatformDictionaryItemSchema })
    body: contracts.UpdatePlatformDictionaryItem,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary-item',
      'update',
      itemId,
      { ...body, dictionaryId },
      this.requestId(response),
      contracts.PlatformDictionaryItemSchema,
    );
  }

  @Delete('dictionaries/:dictionaryId/items/:itemId')
  @ApiOperation({ operationId: 'deletePlatformDictionaryItem' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformSystemDeleteResultSchema,
  })
  deletePlatformDictionaryItem(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Param('itemId', { schema: contracts.UserIdSchema }) itemId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary-item',
      'delete',
      itemId,
      { dictionaryId },
      this.requestId(response),
      contracts.PlatformSystemDeleteResultSchema,
    );
  }

  @Patch('dictionaries/:dictionaryId/items/:itemId/status')
  @ApiOperation({ operationId: 'setPlatformDictionaryItemStatus' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformDictionaryItemSchema,
  })
  setPlatformDictionaryItemStatus(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('dictionaryId', { schema: contracts.UserIdSchema })
    dictionaryId: string,
    @Param('itemId', { schema: contracts.UserIdSchema }) itemId: string,
    @Body({ schema: contracts.SetPlatformSystemStatusSchema })
    body: contracts.SetPlatformSystemStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.catalog(
      actor,
      'dictionary-item',
      'set-status',
      itemId,
      { ...body, dictionaryId },
      this.requestId(response),
      contracts.PlatformDictionaryItemSchema,
    );
  }

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
