import type { INestApplication } from '@nestjs/common';

export function configureApp(app: INestApplication): void {
  // 业务接口统一挂在 /api/v1。文档入口和未来的 /api/auth 不走这个前缀。
  app.setGlobalPrefix('api/v1');
}
