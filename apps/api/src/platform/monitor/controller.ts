import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorSchema, PlatformMonitorSchema } from '@workspace/contracts';
import type { PlatformPrincipal } from '../platform-access.service';
import { CurrentPlatform, RequirePlatform } from '../platform.guard';
import { PlatformMonitorService } from './service';

@ApiTags('platform-monitor')
@Controller('platform/monitor')
@RequirePlatform()
export class PlatformMonitorController {
  constructor(private readonly monitor: PlatformMonitorService) {}
  @Get()
  @ApiOperation({ operationId: 'getPlatformMonitor' })
  @ApiResponse({ status: 200, standardSchema: PlatformMonitorSchema })
  @ApiResponse({ status: 401, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 403, standardSchema: ApiErrorSchema })
  @ApiResponse({ status: 500, standardSchema: ApiErrorSchema })
  read(@CurrentPlatform() actor: PlatformPrincipal) {
    return this.monitor.read(actor);
  }
}
