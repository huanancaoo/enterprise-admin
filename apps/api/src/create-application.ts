import type { NestApplicationOptions } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { readPlatformDefaultLocale } from '@workspace/database';
import { readDeploymentSummary } from './config/deployment-summary';
import { runWithAuthRequestContext } from '@workspace/database/auth';
import { AppModule } from './app.module';
import type { ApplicationConfig } from './config/application-config';
import { EmailRuntime } from './email/email-runtime';
import { configureApp } from './http/configure-app';
import { AuthRuntime } from './identity/auth-runtime';
import { setupSwagger } from './openapi/setup-swagger';
import { createFilesRuntime, FilesRuntime } from './files/files-runtime';
import { readWorkerConfig } from '@workspace/jobs';
import { PROJECT_IMPORT_MAX_BYTES } from '@workspace/contracts';
import { initializeTelemetry } from '@workspace/observability';

export async function createApplication(
  config: ApplicationConfig,
  options: NestApplicationOptions = {},
): Promise<NestExpressApplication> {
  initializeTelemetry('enterprise-admin-api');
  let email: EmailRuntime | undefined;
  let runtime: AuthRuntime | undefined;
  let files: FilesRuntime | undefined;
  try {
    runtime = new AuthRuntime(config, (pool) => {
      email = new EmailRuntime(pool, config);
      return email.hooks;
    });
    files = await createFilesRuntime(config.databaseURL, config.files);
    const app = await NestFactory.create<NestExpressApplication>(
      AppModule.forRoot(
        runtime,
        email!,
        readDeploymentSummary(config),
        files,
        readWorkerConfig({ ...process.env, REDIS_URL: config.redisURL }),
        config.email,
      ),
      { ...options, bodyParser: false, abortOnError: false },
    );
    configureApp(app, () => readPlatformDefaultLocale(runtime!.pool));
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
    // 仅导入容纳 base64 体积；认证仍读取原始流，其他 JSON 保留现有限制。
    app.useBodyParser('json', {
      limit: Math.ceil(PROJECT_IMPORT_MAX_BYTES / 3) * 4 + 1024,
      type: (request) =>
        request.method === 'POST' &&
        /^\/api\/v1\/organizations\/[^/]+\/projects\/imports\/?(?:\?|$)/.test(
          request.url ?? '',
        ) &&
        request.headers['content-type']
          ?.split(';', 1)[0]
          ?.trim()
          .toLowerCase() === 'application/json',
    });
    app.useBodyParser('json');
    app.useBodyParser('urlencoded', { extended: true });
    setupSwagger(app);
    app.enableShutdownHooks();
    return app;
  } catch (error) {
    email?.onModuleDestroy();
    await files?.onApplicationShutdown();
    await runtime?.onApplicationShutdown();
    throw error;
  }
}
