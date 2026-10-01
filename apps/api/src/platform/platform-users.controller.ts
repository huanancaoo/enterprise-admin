import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  UserIdSchema,
  PlatformUsersQuerySchema,
  PlatformUsersPageSchema,
  PlatformUserDetailSchema,
  PlatformSensitiveProfileSchema,
  SensitiveProfileQuerySchema,
  type PlatformUsersQuery,
  type SensitiveProfileQuery,
} from '@workspace/contracts';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformUsers } from './platform-users';

@ApiTags('platform-users')
@Controller('platform/users')
@RequirePlatform()
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformUsersController {
  constructor(private readonly users: PlatformUsers) {}

  @Get()
  @ApiOperation({ operationId: 'listPlatformUsers' })
  @ApiResponse({ status: 200, standardSchema: PlatformUsersPageSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: PlatformUsersQuerySchema }) query: PlatformUsersQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.users.list(actor, query, response.locals.requestId as string);
  }

  @Get(':userId')
  @ApiOperation({ operationId: 'getPlatformUser' })
  @ApiResponse({ status: 200, standardSchema: PlatformUserDetailSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: UserIdSchema }) userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.users.get(actor, userId, response.locals.requestId as string);
  }

  @Get(':userId/sensitive-profile')
  @ApiOperation({ operationId: 'getPlatformSensitiveProfile' })
  @ApiResponse({ status: 200, standardSchema: PlatformSensitiveProfileSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  sensitive(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('userId', { schema: UserIdSchema }) userId: string,
    @Query({ schema: SensitiveProfileQuerySchema })
    query: SensitiveProfileQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.users.sensitive(
      actor,
      userId,
      query.purpose,
      response.locals.requestId as string,
    );
  }
}
