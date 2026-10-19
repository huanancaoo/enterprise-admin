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
export class PlatformParametersController {
  constructor(private readonly system: PlatformSystem) {}
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

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
