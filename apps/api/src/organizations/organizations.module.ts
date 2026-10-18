import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationAuditEvents } from './audit-events';
import { OrganizationMemberOptionsController } from './member-options.controller';
import { OrganizationDirectories } from './organization-directories';
import { OrganizationDirectoriesController } from './organization-directories.controller';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [
    OrganizationsController,
    OrganizationMemberOptionsController,
    OrganizationDirectoriesController,
  ],
  providers: [OrganizationAuditEvents, OrganizationDirectories],
})
export class OrganizationsModule {}
