import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { requestLanguage } from './request-language';
import { ApiErrorFilter } from './api-error.filter';

import { requestLogging } from './request-logging';

export function configureApp(app: INestApplication): void {
  // 业务接口统一挂在 /api/v1。文档入口和 /api/auth 不走这个前缀。
  app.use(requestLogging);
  app.use(requestLanguage);
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(new ApiErrorFilter());
  app.setGlobalPrefix('api/v1');
}
