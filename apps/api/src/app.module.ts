import { DynamicModule, Module } from '@nestjs/common';
import { AuthorizationModule } from './authorization/authorization.module';
import { EmailModule } from './email/email.module';
import { EmailRuntime } from './email/email-runtime';
import { AuthRuntime } from './identity/auth-runtime';
import { IdentityModule } from './identity/identity.module';
import { LocaleSettingsModule } from './locale-settings/locale-settings.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformModule } from './platform/platform.module';
import { ProjectsModule } from './projects/projects.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({})
export class AppModule {
  static forRoot(
    runtime: AuthRuntime,
    email: EmailRuntime,
    platformDatabaseURL: string,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        IdentityModule.forRoot(runtime),
        LocaleSettingsModule,
        EmailModule.forRoot(email),
        AuthorizationModule,
        TenancyModule,
        OrganizationsModule,
        ProjectsModule,
        PlatformModule.forRoot(platformDatabaseURL),
      ],
    };
  }
}
