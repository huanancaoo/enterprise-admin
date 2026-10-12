import { TenantWrite } from './tenant-write';
import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';

@Module({
  imports: [AuthorizationModule],
  providers: [TenantContextService, TenantGuard, TenantWrite],
  exports: [TenantContextService, TenantGuard, TenantWrite],
})
export class TenancyModule {}
