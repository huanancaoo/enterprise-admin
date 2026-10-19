import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
export class PlatformNavigationController {
  constructor(private readonly system: PlatformSystem) {}
  @Get('navigation')
  @ApiOperation({ operationId: 'listPlatformNavigation' })
  @ApiResponse({
    status: 200,
    standardSchema: contracts.PlatformNavigationSchema,
  })
  listPlatformNavigation(
    @CurrentPlatform() actor: PlatformPrincipal,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.system.menus.navigation(actor, this.requestId(response));
  }

  private requestId(response: Response): string {
    response.setHeader('Cache-Control', 'private, no-store');
    return response.locals.requestId as string;
  }
}
