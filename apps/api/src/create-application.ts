import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { runWithAuthRequestContext } from '@workspace/database/auth';
import { AppModule } from './app.module';
import type { ApplicationConfig } from './config/application-config';
import { EmailRuntime } from './email/email-runtime';
import { configureApp } from './http/configure-app';
import { AuthRuntime } from './identity/auth-runtime';
import { setupSwagger } from './openapi/setup-swagger';

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
      AppModule.forRoot(runtime, email!),
      { ...options, bodyParser: false, abortOnError: false },
    );
    configureApp(app);
    // Better Auth 需要原始请求流；Nest 的业务 JSON 解析必须在认证路由之后。
    const server = app.getHttpAdapter().getInstance();
    server.set('trust proxy', config.trustedProxies);
    const authHandler = toNodeHandler(runtime.auth);
    server.all('/api/auth/*path', (request, response) => {
      return runWithAuthRequestContext(
        {
          requestId: response.locals.requestId as string,
          clientIp: request.ip,
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
