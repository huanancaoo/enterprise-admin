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
import { type DeploymentSummary } from './config/deployment-summary';
import { PersonalMediaModule } from './personal-media/personal-media.module';
import { FilesModule } from './files/files.module';
import { FilesRuntime } from './files/files-runtime';

@Module({})
export class AppModule {
  static forRoot(
    runtime: AuthRuntime,
    email: EmailRuntime,
    deployment: DeploymentSummary,
    files: FilesRuntime,
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
        FilesModule.forRoot(files),
        PersonalMediaModule.forRoot(files),
        PlatformModule.forRoot(deployment),
      ],
    };
  }
}
