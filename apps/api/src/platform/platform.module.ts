import { Module } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformUsers } from './platform-users';
import { PlatformUsersController } from './platform-users.controller';

import { PlatformAudit } from './platform-audit';
import { PlatformAuditController } from './platform-audit.controller';

@Module({
  controllers: [
    PlatformController,
    PlatformOrganizationsController,
    PlatformUsersController,
    PlatformAuditController,
  ],
  providers: [
    PlatformAccessService,
    PlatformGuard,
    PlatformOrganizations,
    PlatformUsers,
    PlatformAudit,
  ],
})
export class PlatformModule {}
