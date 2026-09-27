import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { LocaleSettingsController } from './locale-settings.controller';
import { LocaleSettings } from './locale-settings';

@Module({
  imports: [AuthorizationModule, TenancyModule],
  controllers: [LocaleSettingsController],
  providers: [LocaleSettings],
})
export class LocaleSettingsModule {}
