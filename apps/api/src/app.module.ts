import { DynamicModule, Module } from '@nestjs/common';
import { AuthorizationModule } from './authorization/authorization.module';
import { EmailModule } from './email/email.module';
import { EmailRuntime } from './email/email-runtime';
import { AuthRuntime } from './identity/auth-runtime';
import { IdentityModule } from './identity/identity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PlatformModule } from './platform/platform.module';
import { ProjectsModule } from './projects/projects.module';
import { TenancyModule } from './tenancy/tenancy.module';

@Module({})
export class AppModule {
  static forRoot(runtime: AuthRuntime, email: EmailRuntime): DynamicModule {
    return {
      module: AppModule,
      imports: [
        IdentityModule.forRoot(runtime),
        EmailModule.forRoot(email),
        AuthorizationModule,
        TenancyModule,
        OrganizationsModule,
        ProjectsModule,
        PlatformModule,
      ],
    };
  }
}
