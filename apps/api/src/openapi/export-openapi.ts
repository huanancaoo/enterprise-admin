import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';
import { createOpenApiDocument } from './create-document';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);

  const document = createOpenApiDocument(app);
  const outFile = join(__dirname, '..', '..', 'openapi', 'openapi.json');

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();
}

void exportOpenApi();
