import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module';
import { AuthRuntime, type AuthConfig } from './auth-runtime';
import { configureApp } from './configure-app';
import { setupSwagger } from './openapi/setup-swagger';
import { IdentityService } from './identity.service';
import { AuthorizationService } from './authorization.service';
import { TenantContextService } from './tenant-context.service';
import { TenantGuard } from './tenant.guard';
import { ProjectPolicy } from './project.policy';

export async function createApplication(
  config: AuthConfig,
  options: NestApplicationOptions = {},
): Promise<NestExpressApplication> {
  const runtime = new AuthRuntime(config);
  try {
    const app = await NestFactory.create<NestExpressApplication>(
      {
        module: AppModule,
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
    server.all('/api/auth/*path', toNodeHandler(runtime.auth));
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
