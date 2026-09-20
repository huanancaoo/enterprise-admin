import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createApplication } from '../create-application';
import { createOpenApiDocument } from './create-document';

async function exportOpenApi(): Promise<void> {
  // 与正式应用使用同一注册入口；仅导出元数据，不监听端口、不查询数据库。
  const app = await createApplication(
    {
      databaseURL: 'postgresql://localhost/openapi_metadata_only',
      baseURL: 'http://localhost:3000',
      secret: 'openapi-metadata-only-not-a-runtime-secret',
      trustedOrigins: [],
      github: {
        clientId: 'openapi-metadata-only',
        clientSecret: 'openapi-metadata-only',
      },
      email: {
        smtp: { host: '127.0.0.1', port: 1025, secure: false },
        from: { email: 'noreply@example.test', name: 'OpenAPI' },
        encryptionKey: Buffer.alloc(32, 1),
        linkOrigin: 'http://localhost:3200',
        defaultLocale: 'zh-CN',
        pollIntervalMs: 1000,
        retry: { maxAttempts: 5, baseDelayMs: 200 },
        messageTtlMs: 86_400_000,
      },
    },
    { logger: false },
  );

  const document = createOpenApiDocument(app);
  const outFile = join(__dirname, '..', '..', 'openapi', 'openapi.json');

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);

  await app.close();
}

void exportOpenApi();
