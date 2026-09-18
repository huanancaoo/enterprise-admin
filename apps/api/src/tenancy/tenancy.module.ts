import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [AuthorizationModule],
  providers: [TenantContextService, TenantGuard],
  exports: [TenantContextService, TenantGuard],
})
export class TenancyModule {}
