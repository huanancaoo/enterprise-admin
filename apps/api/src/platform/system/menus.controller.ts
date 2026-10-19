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
export class PlatformMenusController {
  constructor(private readonly system: PlatformSystem) {}
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

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
