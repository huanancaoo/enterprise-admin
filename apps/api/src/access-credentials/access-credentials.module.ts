import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AccessCredentials } from './access-credentials';
import {
  AccessCredentialsController,
  CookieCredentialManagementGuard,
} from './access-credentials.controller';
@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [AccessCredentialsController],
  providers: [AccessCredentials, CookieCredentialManagementGuard],
})
export class AccessCredentialsModule {}
