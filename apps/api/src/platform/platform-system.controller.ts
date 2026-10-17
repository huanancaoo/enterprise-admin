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
    return this.system.menus.registry(actor, this.requestId(response));
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
    return this.system.menus.navigation(actor, this.requestId(response));
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
    return this.system.dictionaries.refresh(actor, this.requestId(response));
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
    return this.system.dictionaries.getByKey(
      actor,
      key,
      this.requestId(response),
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
    return this.system.parameters.refresh(actor, this.requestId(response));
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
    return this.system.parameters.getByKey(
      actor,
      key,
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
    return this.system.menus.list(actor, query, this.requestId(response));
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
    return this.system.menus.create(actor, body, this.requestId(response));
  }

  @Get('menus/:menuId')
  @ApiOperation({ operationId: 'getPlatformMenu' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformMenuSchema })
  getPlatformMenu(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('menuId', { schema: contracts.UserIdSchema }) menuId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.menus.get(actor, menuId, this.requestId(response));
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
    return this.system.menus.update(
      actor,
      menuId,
      body,
      this.requestId(response),
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
    return this.system.menus.remove(actor, menuId, this.requestId(response));
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
    return this.system.menus.setStatus(
      actor,
      menuId,
      body,
      this.requestId(response),
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
    return this.system.posts.list(actor, query, this.requestId(response));
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
    return this.system.posts.create(actor, body, this.requestId(response));
  }

  @Get('posts/:postId')
  @ApiOperation({ operationId: 'getPlatformPost' })
  @ApiResponse({ status: 200, standardSchema: contracts.PlatformPostSchema })
  getPlatformPost(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('postId', { schema: contracts.UserIdSchema }) postId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.posts.get(actor, postId, this.requestId(response));
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
    return this.system.posts.update(
      actor,
      postId,
      body,
      this.requestId(response),
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
    return this.system.posts.remove(actor, postId, this.requestId(response));
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
    return this.system.posts.setStatus(
      actor,
      postId,
      body,
      this.requestId(response),
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
    return this.system.dictionaries.list(
      actor,
      query,
      this.requestId(response),
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
    return this.system.dictionaries.create(
      actor,
      body,
      this.requestId(response),
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
    return this.system.dictionaries.get(
      actor,
      dictionaryId,
      this.requestId(response),
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
    return this.system.dictionaries.update(
      actor,
      dictionaryId,
      body,
      this.requestId(response),
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
    return this.system.dictionaries.remove(
      actor,
      dictionaryId,
      this.requestId(response),
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
    return this.system.dictionaries.setStatus(
      actor,
      dictionaryId,
      body,
      this.requestId(response),
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
    return this.system.parameters.list(actor, query, this.requestId(response));
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
    return this.system.parameters.create(actor, body, this.requestId(response));
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
    return this.system.parameters.get(
      actor,
      parameterId,
      this.requestId(response),
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
    return this.system.parameters.update(
      actor,
      parameterId,
      body,
      this.requestId(response),
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
    return this.system.parameters.remove(
      actor,
      parameterId,
      this.requestId(response),
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
    return this.system.parameters.setStatus(
      actor,
      parameterId,
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
    return this.system.dictionaries.items.list(
      actor,
      dictionaryId,
      query,
      this.requestId(response),
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
    return this.system.dictionaries.items.create(
      actor,
      dictionaryId,
      body,
      this.requestId(response),
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
    return this.system.dictionaries.items.get(
      actor,
      dictionaryId,
      itemId,
      this.requestId(response),
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
    return this.system.dictionaries.items.update(
      actor,
      dictionaryId,
      itemId,
      body,
      this.requestId(response),
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
    return this.system.dictionaries.items.remove(
      actor,
      dictionaryId,
      itemId,
      this.requestId(response),
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
    return this.system.dictionaries.items.setStatus(
      actor,
      dictionaryId,
      itemId,
      body,
      this.requestId(response),
    );
  }

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
