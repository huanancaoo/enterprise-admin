import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { runWithAuthRequestContext } from '@workspace/database/auth';
import { AppModule } from './app.module';
import { AuthRuntime } from './auth-runtime';
import type { ApplicationConfig } from './application-config';
import { EmailRuntime } from './email/email-runtime';
import { configureApp } from './configure-app';
import { setupSwagger } from './openapi/setup-swagger';
import { IdentityService } from './identity.service';
import { AuthorizationService } from './authorization.service';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';
import { Projects } from './projects';
import { ProjectsController } from './projects.controller';
import { OrganizationsController } from './organizations.controller';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';

export async function createApplication(
  config: ApplicationConfig,
  options: NestApplicationOptions = {},
): Promise<NestExpressApplication> {
  let email: EmailRuntime | undefined;
  let runtime: AuthRuntime | undefined;
  try {
    runtime = new AuthRuntime(config, (pool) => {
      email = new EmailRuntime(pool, config);
      return email.hooks;
    });
    const app = await NestFactory.create<NestExpressApplication>(
      {
        module: AppModule,
        controllers: [
          ProjectsController,
          OrganizationsController,
          PlatformController,
        ],
        providers: [
          { provide: AuthRuntime, useValue: runtime },
          { provide: EmailRuntime, useValue: email },
          IdentityService,
          AuthorizationService,
          TenantContextService,
          TenantGuard,
          PlatformGuard,
          Projects,
        ],
        exports: [
          IdentityService,
          AuthorizationService,
          TenantContextService,
          TenantGuard,
          PlatformGuard,
          Projects,
        ],
      },
      { ...options, bodyParser: false, abortOnError: false },
    );
    configureApp(app);
    // Better Auth 需要原始请求流；Nest 的业务 JSON 解析必须在认证路由之后。
    const server = app.getHttpAdapter().getInstance();
    const authHandler = toNodeHandler(runtime.auth);
    server.all('/api/auth/*path', (request, response) => {
      const rawVersion = request.get('X-Expected-Authz-Version');
      const parsedVersion = rawVersion ? Number(rawVersion) : undefined;
      const expectedAuthorizationVersion =
        parsedVersion !== undefined &&
        Number.isSafeInteger(parsedVersion) &&
        parsedVersion > 0 &&
        parsedVersion <= 2_147_483_647
          ? parsedVersion
          : undefined;
      return runWithAuthRequestContext(
        {
          requestId: response.locals.requestId as string,
          ...(expectedAuthorizationVersion
            ? { expectedAuthorizationVersion }
            : {}),
        },
        () => authHandler(request, response),
      );
    });
    app.useBodyParser('json');
    app.useBodyParser('urlencoded', { extended: true });
    setupSwagger(app);
    app.enableShutdownHooks();
    return app;
  } catch (error) {
    email?.onModuleDestroy();
    await runtime?.onApplicationShutdown();
    throw error;
  }
}
