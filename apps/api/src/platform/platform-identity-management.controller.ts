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
import {
  ApiErrorSchema,
  UserIdSchema,
  CreatePlatformUserSchema,
  UpdatePlatformUserSchema,
  SetPlatformUserStatusSchema,
  PlatformUserDetailSchema,
  PlatformUserMutationResultSchema,
  LoginLogsQuerySchema,
  LoginLogsPageSchema,
  PlatformSessionsQuerySchema,
  PlatformSessionsPageSchema,
  SessionRevokeResultSchema,
  PasswordResetRequestResultSchema,
  LoginMethodSchema,
  LoginResultSchema,
  type CreatePlatformUser,
  type UpdatePlatformUser,
  type SetPlatformUserStatus,
  type LoginLogsQuery,
  type PlatformSessionsQuery,
} from '@workspace/contracts';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformIdentityManagement } from './platform-identity-management';

@ApiTags('platform-identity-management')
@Controller('platform')
@RequirePlatform()
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformIdentityManagementController {
  constructor(private readonly identity: PlatformIdentityManagement) {}

  @Post('users')
  @ApiOperation({ operationId: 'createPlatformUser' })
  @ApiResponse({ status: 201, standardSchema: PlatformUserDetailSchema })
  create(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: CreatePlatformUserSchema }) body: CreatePlatformUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.create(
      actor,
      body,
      response.locals.requestId as string,
    );
  }

  @Patch('users/:userId')
  @ApiOperation({ operationId: 'updatePlatformUser' })
  @ApiResponse({
    status: 200,
    standardSchema: PlatformUserMutationResultSchema,
  })
  update(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: UserIdSchema }) userId: string,
    @Body({ schema: UpdatePlatformUserSchema }) body: UpdatePlatformUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.update(
      actor,
      userId,
      body,
      response.locals.requestId as string,
    );
  }

  @Patch('users/:userId/status')
  @ApiOperation({ operationId: 'setPlatformUserStatus' })
  @ApiResponse({
    status: 200,
    standardSchema: PlatformUserMutationResultSchema,
  })
  status(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: UserIdSchema }) userId: string,
    @Body({ schema: SetPlatformUserStatusSchema }) body: SetPlatformUserStatus,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.setStatus(
      actor,
      userId,
      body,
      response.locals.requestId as string,
    );
  }

  @Post('users/:userId/password-reset')
  @HttpCode(200)
  @ApiOperation({ operationId: 'requestPlatformUserPasswordReset' })
  @ApiResponse({
    status: 200,
    standardSchema: PasswordResetRequestResultSchema,
  })
  reset(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: UserIdSchema }) userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.requestPasswordReset(
      actor,
      userId,
      response.locals.requestId as string,
    );
  }

  @Get('login-events')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String, format: 'uuid' })
  @ApiQuery({
    name: 'result',
    required: false,
    enum: LoginResultSchema.options,
  })
  @ApiQuery({
    name: 'method',
    required: false,
    enum: LoginMethodSchema.options,
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOperation({ operationId: 'listPlatformLoginEvents' })
  @ApiResponse({ status: 200, standardSchema: LoginLogsPageSchema })
  loginEvents(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: LoginLogsQuerySchema }) query: LoginLogsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.loginEvents(
      actor,
      query,
      response.locals.requestId as string,
    );
  }

  @Get('sessions')
  @ApiQuery({ name: 'q', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String, format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOperation({ operationId: 'listPlatformSessions' })
  @ApiResponse({ status: 200, standardSchema: PlatformSessionsPageSchema })
  sessions(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: PlatformSessionsQuerySchema })
    query: PlatformSessionsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.sessions(
      actor,
      query,
      response.locals.requestId as string,
    );
  }

  @Delete('sessions/:sessionId')
  @ApiOperation({ operationId: 'revokePlatformSession' })
  @ApiResponse({ status: 200, standardSchema: SessionRevokeResultSchema })
  revoke(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('sessionId', { schema: UserIdSchema }) sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.identity.revokeSession(
      actor,
      sessionId,
      response.locals.requestId as string,
    );
  }
}
