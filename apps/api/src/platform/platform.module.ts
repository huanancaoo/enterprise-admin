import { PlatformStoragePolicyService } from './platform-storage-policy';
import { PlatformStoragePolicyController } from './platform-storage-policy.controller';
import { Module, type DynamicModule } from '@nestjs/common';
import {
  PLATFORM_DEPLOYMENT_SUMMARY,
  type DeploymentSummary,
} from '../config/deployment-summary';
import { PlatformSettings } from './platform-settings';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformAccessService } from './platform-access.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformUsers } from './platform-users';
import { PlatformUsersController } from './platform-users.controller';

import { PlatformAudit } from './platform-audit';
import { PlatformAuditController } from './platform-audit.controller';
import {
  PlatformIdentityManagement,
  PLATFORM_PASSWORD_RESET_REDIRECT,
} from './platform-identity-management';
import { PlatformIdentityManagementController } from './platform-identity-management.controller';
import { PersonalLoginEventsController } from './personal-login-events.controller';

@Module({
  controllers: [
    PlatformController,
    PlatformOrganizationsController,
    PlatformUsersController,
    PlatformAuditController,
    PlatformSettingsController,
    PlatformStoragePolicyController,
    PlatformIdentityManagementController,
    PersonalLoginEventsController,
  ],
  providers: [
    PlatformAccessService,
    PlatformGuard,
    PlatformOrganizations,
    PlatformUsers,
    PlatformAudit,
    PlatformSettings,
    PlatformStoragePolicyService,
    PlatformIdentityManagement,
  ],
})
export class PlatformModule {
  static forRoot(
    deployment: DeploymentSummary,
    passwordResetRedirect: string,
  ): DynamicModule {
    return {
      module: PlatformModule,
      providers: [
        { provide: PLATFORM_DEPLOYMENT_SUMMARY, useValue: deployment },
        {
          provide: PLATFORM_PASSWORD_RESET_REDIRECT,
          useValue: passwordResetRedirect,
        },
      ],
    };
  }
}
