import type { INestApplication } from '@nestjs/common';

import { requestLogging } from './request-logging';

export function configureApp(app: INestApplication): void {
  // 业务接口统一挂在 /api/v1。文档入口和 /api/auth 不走这个前缀。
  app.use(requestLogging);
  app.setGlobalPrefix('api/v1');
}
