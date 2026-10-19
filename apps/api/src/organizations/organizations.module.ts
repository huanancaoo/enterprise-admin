import { Module, type DynamicModule } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OrganizationAuditEvents } from './audit-events';
import { OrganizationMemberOptionsController } from './member-options.controller';
import { OrganizationDirectories } from './organization-directories';
import { OrganizationDirectoriesController } from './organization-directories.controller';
import { OrganizationExportsController } from './organization-exports.controller';
import { OrganizationInvitationImportsController } from './organization-invitation-imports.controller';
import { OrganizationTaskSubmission } from './organization-task-submission';
import { OrganizationsController } from './organizations.controller';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [
    OrganizationExportsController,
    OrganizationInvitationImportsController,
    OrganizationsController,
    OrganizationMemberOptionsController,
    OrganizationDirectoriesController,
  ],
  providers: [
    OrganizationTaskSubmission,
    OrganizationAuditEvents,
    OrganizationDirectories,
  ],
})
export class OrganizationsModule {
  static forRoot(tasks: DynamicModule): DynamicModule {
    return { module: OrganizationsModule, imports: [tasks] };
  }
}
