import { Body, Controller, Get, Headers, Patch, Res } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorSchema,
  IdempotencyKeySchema,
  PlatformSettingsSchema,
  PlatformSettingsUpdateResultSchema,
  UpdatePlatformSettingsSchema,
  type UpdatePlatformSettings,
} from '@workspace/contracts';
import { CurrentPlatform, RequirePlatform } from './platform.guard';
import type { PlatformPrincipal } from './platform-access.service';
import { ApiException } from '../http/api-exception';
import { PlatformSettings } from './platform-settings';

@ApiTags('platform-settings')
@Controller('platform/settings')
@RequirePlatform()
@ApiResponse({ status: 400, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
@ApiResponse({ status: 503, standardSchema: ApiErrorSchema })
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettings) {}
  @Get()
  @ApiOperation({ operationId: 'getPlatformSettings' })
  @ApiResponse({ status: 200, standardSchema: PlatformSettingsSchema })
  get(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.settings.get(actor, response.locals.requestId as string);
  }
  @Patch()
  @ApiOperation({ operationId: 'updatePlatformSettings' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', maxLength: 128 },
  })
  @ApiResponse({
    status: 200,
    standardSchema: PlatformSettingsUpdateResultSchema,
  })
  @ApiResponse({ status: 409, standardSchema: ApiErrorSchema })
  update(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Body({ schema: UpdatePlatformSettingsSchema })
    input: UpdatePlatformSettings,
    @Headers('idempotency-key') key: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const parsed = IdempotencyKeySchema.safeParse(key);
    if (!parsed.success) throw new ApiException(400, 'VALIDATION_ERROR');
    return this.settings.update(
      actor,
      input,
      parsed.data,
      response.locals.requestId as string,
    );
  }
}
