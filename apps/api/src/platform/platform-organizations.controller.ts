import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  OrganizationIdSchema,
  IdempotencyKeySchema,
  TransitionOrganizationSchema,
  OrganizationTransitionResultSchema,
  PlatformOrganizationDetailSchema,
  PlatformOrganizationPageSchema,
  PlatformOrganizationQuerySchema,
  type OrganizationTransitionResult,
  type TransitionOrganization,
  type PlatformOrganizationDetail,
  type PlatformOrganizationQuery,
  type PlatformOrganizationPage,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformOrganizations } from './platform-organizations';

@ApiTags('platform-organizations')
@Controller('platform/organizations')
@RequirePlatform()
export class PlatformOrganizationsController {
  constructor(private readonly organizations: PlatformOrganizations) {}

  @Get()
  @ApiOperation({ operationId: 'listPlatformOrganizations' })
  @ApiResponse({ status: 200, standardSchema: PlatformOrganizationPageSchema })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  list(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Query({ schema: PlatformOrganizationQuerySchema })
    query: PlatformOrganizationQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformOrganizationPage> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.organizations.list(
      actor,
      query,
      response.locals.requestId as string,
    );
  }

  @Get(':organizationId')
  @ApiOperation({ operationId: 'getPlatformOrganization' })
  @ApiResponse({
    status: 200,
    standardSchema: PlatformOrganizationDetailSchema,
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PlatformOrganizationDetail> {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.organizations.get(
      actor,
      organizationId,
      response.locals.requestId as string,
    );
  }

  @Post(':organizationId/suspend')
  @HttpCode(200)
  @ApiOperation({ operationId: 'suspendPlatformOrganization' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z0-9:_-]+$',
    },
  })
  @ApiResponse({
    status: 200,
    standardSchema: OrganizationTransitionResultSchema,
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  suspend(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Body({ schema: TransitionOrganizationSchema })
    input: TransitionOrganization,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationTransitionResult> {
    return this.transition(
      actor,
      organizationId,
      'suspend',
      input,
      key,
      response,
    );
  }

  @Post(':organizationId/resume')
  @HttpCode(200)
  @ApiOperation({ operationId: 'resumePlatformOrganization' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      pattern: '^[A-Za-z0-9:_-]+$',
    },
  })
  @ApiResponse({
    status: 200,
    standardSchema: OrganizationTransitionResultSchema,
  })
  @ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
  resume(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Body({ schema: TransitionOrganizationSchema })
    input: TransitionOrganization,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationTransitionResult> {
    return this.transition(
      actor,
      organizationId,
      'resume',
      input,
      key,
      response,
    );
  }

  private transition(
    actor: PlatformPrincipal,
    organizationId: string,
    action: 'suspend' | 'resume',
    input: TransitionOrganization,
    key: string,
    response: Response,
  ): Promise<OrganizationTransitionResult> {
    response.setHeader('Cache-Control', 'private, no-store');
    const parsed = IdempotencyKeySchema.safeParse(key);
    if (!parsed.success) throw new ApiException(400, 'VALIDATION_ERROR');
    return this.organizations.transition(
      actor,
      organizationId,
      action,
      input,
      parsed.data,
      response.locals.requestId as string,
    );
  }
}
