import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorSchema,
  PlatformAccessSchema,
  type PlatformAccess,
} from '@workspace/contracts';
import type { Identity } from '../identity/identity.service';
import { CurrentPlatform, RequirePlatform } from './platform.guard';

@ApiTags('platform')
@Controller()
export class PlatformController {
  @Get('me/platform')
  @RequirePlatform()
  @ApiOperation({ operationId: 'getMyPlatformAccess' })
  @ApiResponse({ status: 200, standardSchema: PlatformAccessSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  me(@CurrentPlatform() identity: Identity): PlatformAccess {
    return { userId: identity.userId };
  }
}
