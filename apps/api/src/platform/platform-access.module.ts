import { Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';
import { PlatformGuard } from './platform.guard';

@Module({
  providers: [PlatformAccessService, PlatformGuard],
  exports: [PlatformAccessService, PlatformGuard],
})
export class PlatformAccessModule {}
