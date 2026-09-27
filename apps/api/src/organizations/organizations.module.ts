import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationAuditEvents } from './audit-events';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [OrganizationsController],
  providers: [OrganizationAuditEvents],
})
export class OrganizationsModule {}
