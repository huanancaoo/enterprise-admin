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
export class PlatformDictionariesController {
  constructor(private readonly system: PlatformSystem) {}
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
