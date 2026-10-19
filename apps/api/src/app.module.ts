import { DynamicModule, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import type { WorkerConfig } from '@workspace/jobs';
import { AccessCredentialsModule } from './access-credentials/access-credentials.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { BusinessModule } from './business/business.module';
import { type DeploymentSummary } from './config/deployment-summary';
import type { EmailConfig } from './email/email-config';
import { EmailRuntime } from './email/email-runtime';
import { EmailModule } from './email/email.module';
import { FilesRuntime } from './files/files-runtime';
import { FilesModule } from './files/files.module';
import { TelemetryRuntime } from './http/telemetry-runtime';
import { AuthRuntime } from './identity/auth-runtime';
import { IdentityModule } from './identity/identity.module';
import { LocaleSettingsModule } from './locale-settings/locale-settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PersonalMediaModule } from './personal-media/personal-media.module';
import { PlatformResourcesModule } from './platform-resources/platform-resources.module';
import { PlatformMonitorModule } from './platform/monitor/platform-monitor.module';
import { PlatformModule } from './platform/platform.module';
import { PlatformSchedulesModule } from './platform/schedules/platform-schedules.module';
import { PlatformTasksModule } from './platform/tasks/platform-tasks.module';
import { ProjectsModule } from './projects/projects.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { WebhooksModule } from './webhooks/webhooks.module';

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
    // 同一动态模块对象供所有消费者导入，任务生产者与运行时只实例化一次。
    const business = BusinessModule.forRoot(jobs);
    const platformTasks = PlatformTasksModule.forRoot(
      jobs,
      emailConfig.encryptionKey,
    );
    const platformMonitor = PlatformMonitorModule.forRoot(
      platformTasks,
      jobs,
      files,
    );
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
        OrganizationsModule.forRoot(business),
        ProjectsModule.forRoot(business),
        business,
        WebhooksModule.forRoot({
          worker: jobs,
          timeoutMs: 10_000,
          pollIntervalMs: emailConfig.pollIntervalMs,
        }),
        NotificationsModule.forRoot({ email: emailConfig, worker: jobs }),
        AccessCredentialsModule,
        FilesModule.forRoot(files),
        PlatformResourcesModule.forRoot(files),
        platformTasks,
        platformMonitor,
        PlatformSchedulesModule.forRoot(platformMonitor),
        PersonalMediaModule.forRoot(files),
        PlatformModule.forRoot(
          deployment,
          `${emailConfig.linkOrigin}/reset-password`,
        ),
      ],
    };
  }
}
