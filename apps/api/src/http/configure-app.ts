import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import {
  requestLanguage,
  RequestLanguageInterceptor,
  getRequestLanguage,
} from './request-language';
import type { Response } from 'express';
import type { SupportedLocale } from '@workspace/i18n';
import { ApiErrorFilter } from './api-error.filter';

import { requestLogging } from './request-logging';

export function configureApp(
  app: INestApplication,
  resolvePlatformLocale: () => Promise<SupportedLocale>,
): void {
  // 业务接口统一挂在 /api/v1。文档入口和 /api/auth 不走这个前缀。
  app.use(requestLogging);
  app.use(requestLanguage);
  // 全局 Guard 先于身份与租户 Guard；每个业务请求读取最新设置，不缓存旧默认语言。
  app.useGlobalGuards({
    canActivate: async (context) => {
      getRequestLanguage(
        context.switchToHttp().getResponse<Response>(),
      ).usePlatformDefault(await resolvePlatformLocale());
      return true;
    },
  });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new ApiErrorFilter());
  app.useGlobalInterceptors(new RequestLanguageInterceptor());
  app.setGlobalPrefix('api/v1');
}
