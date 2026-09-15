import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import { setupSwagger } from './../src/openapi/setup-swagger';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  it('/api/v1 (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .set('Accept-Language', 'ar')
      .expect(200)
      .expect('Content-Language', 'ar')
      .expect('Content-Type', /text\/html/)
      .expect('Hello World!');
  });

  it('生成独立 requestId，不信任客户端传入值', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1')
      .set('X-Request-Id', 'client-value')
      .expect(200);
    const second = await request(app.getHttpServer())
      .get('/missing')
      .expect(404);
    expect(first.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.headers['x-request-id']).not.toBe(
      second.headers['x-request-id'],
    );
  });

  it('/api/docs-json (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200)
      .expect((res) => {
        const document = res.body as OpenAPIObject;
        expect(document.openapi).toMatch(/^3\./);
        expect(document.info.title).toBe('Enterprise Foundation API');
        expect(document.paths).toHaveProperty('/api/v1');
        expect(document.paths['/api/v1'].get?.responses['200']).toMatchObject({
          content: {
            'text/html': { schema: { type: 'string' } },
          },
        });
      });
  });

  it('/api/docs (GET)', () => {
    return request(app.getHttpServer()).get('/api/docs').expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
