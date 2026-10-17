import { TenantWrite } from './tenant-write';
import { OrganizationMembershipAccess } from './organization-membership-access';
import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [AuthorizationModule],
  providers: [
    TenantContextService,
    TenantGuard,
    TenantWrite,
    OrganizationMembershipAccess,
  ],
  exports: [
    TenantContextService,
    TenantGuard,
    TenantWrite,
    OrganizationMembershipAccess,
  ],
})
export class TenancyModule {}
