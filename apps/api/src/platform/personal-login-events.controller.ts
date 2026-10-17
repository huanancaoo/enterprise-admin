import { Controller, Get, Headers, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  LoginLogsPageSchema,
  PersonalLoginLogsQuerySchema,
  LoginMethodSchema,
  LoginResultSchema,
  type PersonalLoginLogsQuery,
} from '@workspace/contracts';
import { IdentityService } from '../identity/identity.service';
import { PlatformIdentityManagement } from './platform-identity-management';

@ApiTags('personal-login-events')
@Controller('me/login-events')
export class PersonalLoginEventsController {
  constructor(
    private readonly identities: IdentityService,
    private readonly management: PlatformIdentityManagement,
  ) {}

  @Get()
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
  @ApiOperation({ operationId: 'listMyLoginEvents' })
  @ApiResponse({ status: 200, standardSchema: LoginLogsPageSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  async list(
    @Headers() headers: IncomingHttpHeaders,
    @Query({ schema: PersonalLoginLogsQuerySchema })
    query: PersonalLoginLogsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const actor = await this.identities.requireIdentity(
      fromNodeHeaders(headers),
    );
    return this.management.personalLoginEvents(
      actor,
      query,
      response.locals.requestId as string,
    );
  }
}
