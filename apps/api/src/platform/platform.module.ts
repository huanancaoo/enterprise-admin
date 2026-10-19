import { Module, type DynamicModule } from '@nestjs/common';
import {
  PLATFORM_DEPLOYMENT_SUMMARY,
  type DeploymentSummary,
} from '../config/deployment-summary';
import { PlatformAccessModule } from './platform-access.module';
import { PlatformOrganizations } from './platform-organizations';
import { PlatformOrganizationsController } from './platform-organizations.controller';
import { PlatformSettings } from './platform-settings';
import { PlatformSettingsController } from './platform-settings.controller';
import { PlatformStoragePolicyService } from './platform-storage-policy';
import { PlatformStoragePolicyController } from './platform-storage-policy.controller';
import { PlatformUsers } from './platform-users';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformController } from './platform.controller';
import { PlatformSystemModule } from './system/platform-system.module';

import { PersonalLoginEventsController } from './personal-login-events.controller';
import { PlatformAudit } from './platform-audit';
import { PlatformAuditController } from './platform-audit.controller';
import {
  PLATFORM_PASSWORD_RESET_REDIRECT,
  PlatformIdentityManagement,
} from './platform-identity-management';
import { PlatformIdentityManagementController } from './platform-identity-management.controller';

@Module({
  imports: [PlatformAccessModule, PlatformSystemModule],
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
