import { Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformUsers } from './platform-users';
import { PlatformUsersController } from './platform-users.controller';

@Module({
  controllers: [
    PlatformController,
    PlatformOrganizationsController,
    PlatformUsersController,
  ],
  providers: [
    PlatformAccessService,
    PlatformGuard,
    PlatformOrganizations,
    PlatformUsers,
  ],
})
export class PlatformModule {}
