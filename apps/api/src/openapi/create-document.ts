import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Enterprise Foundation API')
    .setVersion('0.1.0')
    .build();

  return SwaggerModule.createDocument(app, config);
}
