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
export class PlatformPostsController {
  constructor(private readonly system: PlatformSystem) {}
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

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
