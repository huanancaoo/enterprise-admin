import { Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';

@Module({
  controllers: [PlatformController],
  providers: [PlatformAccessService, PlatformGuard],
})
export class PlatformModule {}
