import { PlatformResourcesModule } from './platform-resources/platform-resources.module';
import { PlatformTasksModule } from './platform/platform-tasks.module';
import { DynamicModule, Module } from '@nestjs/common';
import { WebhooksModule } from './webhooks/webhooks.module';
import { BusinessModule } from './business/business.module';
import type { WorkerConfig } from '@workspace/jobs';
import type { EmailConfig } from './email/email-config';
import { NotificationsModule } from './notifications/notifications.module';
import { AccessCredentialsModule } from './access-credentials/access-credentials.module';
import { TelemetryRuntime } from './http/telemetry-runtime';
import { ScheduleModule } from '@nestjs/schedule';
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
import { AnnouncementsModule } from './announcements/announcements.module';

@Module({})
export class AppModule {
  static forRoot(
    runtime: AuthRuntime,
    email: EmailRuntime,
    deployment: DeploymentSummary,
    files: FilesRuntime,
    jobs: WorkerConfig,
    emailConfig: EmailConfig,
  ): DynamicModule {
    return {
      module: AppModule,
      providers: [TelemetryRuntime],
      imports: [
        AnnouncementsModule,
        ScheduleModule.forRoot(),
        IdentityModule.forRoot(runtime),
        LocaleSettingsModule,
        EmailModule.forRoot(email),
        AuthorizationModule,
        TenancyModule,
        OrganizationsModule,
        ProjectsModule,
        BusinessModule.forRoot(jobs),
        WebhooksModule.forRoot({
          worker: jobs,
          timeoutMs: 10_000,
          pollIntervalMs: emailConfig.pollIntervalMs,
        }),
        NotificationsModule.forRoot({ email: emailConfig, worker: jobs }),
        AccessCredentialsModule,
        FilesModule.forRoot(files),
        PlatformResourcesModule.forRoot(files),
        PlatformTasksModule.forRoot(jobs, emailConfig.encryptionKey, files),
        PersonalMediaModule.forRoot(files),
        PlatformModule.forRoot(
          deployment,
          `${emailConfig.linkOrigin}/reset-password`,
        ),
      ],
    };
  }
}
