import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { runWithAuthRequestContext } from '@workspace/database/auth';
import { AppModule } from './app.module';
import { AuthRuntime, type AuthConfig } from './auth-runtime';
import { configureApp } from './configure-app';
import { setupSwagger } from './openapi/setup-swagger';
import { IdentityService } from './identity.service';
import { AuthorizationService } from './authorization.service';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';
import { ProjectPolicy } from './project.policy';
import { ProjectsController } from './projects.controller';
import { OrganizationsController } from './organizations.controller';

export async function createApplication(
  config: AuthConfig,
  options: NestApplicationOptions = {},
): Promise<NestExpressApplication> {
  const runtime = new AuthRuntime(config);
  try {
    const app = await NestFactory.create<NestExpressApplication>(
      {
        module: AppModule,
        controllers: [ProjectsController, OrganizationsController],
        providers: [
          { provide: AuthRuntime, useValue: runtime },
          IdentityService,
          AuthorizationService,
          TenantContextService,
          TenantGuard,
          ProjectPolicy,
        ],
        exports: [
          IdentityService,
          AuthorizationService,
          TenantContextService,
          TenantGuard,
          ProjectPolicy,
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
    await runtime.onApplicationShutdown();
    throw error;
  }
}
