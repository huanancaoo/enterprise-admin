import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  IdempotencyKeySchema,
  OrganizationIdSchema,
  PlatformStoragePolicySchema,
  PlatformStoragePolicyUpdateResultSchema,
  UpdatePlatformStoragePolicySchema,
  type UpdatePlatformStoragePolicy,
} from '@workspace/contracts';
import { ApiException } from '../http/api-exception';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { PlatformStoragePolicyService } from './platform-storage-policy';

@ApiTags('platform-storage')
@Controller('platform/organizations/:organizationId/storage-policy')
@RequirePlatform()
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 404, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformStoragePolicyController {
  constructor(private readonly policy: PlatformStoragePolicyService) {}

  @Get()
  @ApiOperation({ operationId: 'getPlatformStoragePolicy' })
  @ApiResponse({ status: 200, standardSchema: PlatformStoragePolicySchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.policy.get(
      actor,
      organizationId,
      response.locals.requestId as string,
    );
  }

  @Patch()
  @ApiOperation({ operationId: 'updatePlatformStoragePolicy' })
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
    standardSchema: PlatformStoragePolicyUpdateResultSchema,
  })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  update(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Param('organizationId', { schema: OrganizationIdSchema })
    organizationId: string,
    @Body({ schema: UpdatePlatformStoragePolicySchema })
    input: UpdatePlatformStoragePolicy,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const parsed = IdempotencyKeySchema.safeParse(key);
    if (!parsed.success) throw new ApiException(400, 'VALIDATION_ERROR');
    return this.policy.update(
      actor,
      organizationId,
      input,
      parsed.data,
      response.locals.requestId as string,
    );
  }
}
