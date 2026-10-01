import { Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformOrganizationsController } from './platform-organizations.controller';

@Module({
  controllers: [PlatformController, PlatformOrganizationsController],
  providers: [PlatformAccessService, PlatformGuard, PlatformOrganizations],
})
export class PlatformModule {}
