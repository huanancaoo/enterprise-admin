import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { createOpenApiDocument } from './create-document';

export function setupSwagger(app: INestApplication): void {
  // 生产同时关闭 UI 和规范端点；只藏页面会留下 /api/docs-json。
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const document = createOpenApiDocument(app);

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: '/api/docs-json',
    useGlobalPrefix: false,
    raw: ['json'],
  });
}
