import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Module } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { App } from 'supertest/types';
import { configureApp } from './../src/http/configure-app';
import { setupSwagger } from './../src/openapi/setup-swagger';

@Module({})
class HttpHarnessModule {}

describe('HTTP 横切（e2e）', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HttpHarnessModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();
  });

  it('/api/v1 无业务路由时仍协商语言且禁止共享缓存', () => {
    return request(app.getHttpServer())
      .get('/api/v1')
      .set('Accept-Language', 'ar')
      .expect(404)
      .expect('Content-Language', 'ar')
      .expect('Cache-Control', 'private, no-store');
  });

  it('生成独立 requestId，不信任客户端传入值', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1')
      .set('X-Request-Id', 'client-value')
      .expect(404);
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
        expect(document.paths).not.toHaveProperty('/api/v1');
      });
  });

  it('/api/docs (GET)', () => {
    return request(app.getHttpServer()).get('/api/docs').expect(200);
  });

  afterEach(async () => {
    await app.close();
  });
});
