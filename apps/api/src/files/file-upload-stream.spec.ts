import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  readFileOverwrite,
  readFileUpload,
  type OrganizationFileOverwrite,
  type OrganizationFileUpload,
} from './file-upload-stream';
import { StorageError, type StorageAddress } from './storage/storage';

const boundary = 'file-intake-test';
const body = Buffer.from('实际内容');
const facts = {
  bytes: body.byteLength,
  sha256: createHash('sha256').update(body).digest('hex'),
};
const address: StorageAddress = {
  owner: { kind: 'organization', id: randomUUID() },
  area: 'files',
  segments: ['test.bin'],
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fixture(kind: 'upload' | 'overwrite' = 'upload') {
  const input = Object.assign(new PassThrough(), {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
  const output = new EventEmitter();
  const fields = {
    operationId: randomUUID(),
    ...(kind === 'upload'
      ? { parentId: randomUUID(), name: 'test.bin' }
      : { expectedRevision: 1 }),
    declaredBytes: facts.bytes,
    contentSha256: facts.sha256,
  };
  const prefix =
    Object.entries(fields)
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
      .join('') +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const start = <Result>(
    use: (
      upload: OrganizationFileUpload | OrganizationFileOverwrite,
    ) => Promise<Result>,
  ) =>
    (kind === 'upload' ? readFileUpload : readFileOverwrite)(
      input as unknown as Request,
      output as unknown as Response,
      use,
    );
  return {
    input,
    output,
    start,
    sendContent() {
      // 边界已结束内容流，但还没有说明它是否为最终边界，也未结束 HTTP 请求。
      input.write(Buffer.concat([Buffer.from(prefix), body]));
      input.write(`\r\n--${boundary}`);
    },
    finish() {
      input.end('--\r\n');
    },
    expectReleased() {
      expect(input.listenerCount('aborted')).toBe(0);
      expect(input.listenerCount('error')).toBe(0);
      expect(output.listenerCount('close')).toBe(0);
    },
  };
}

describe('组织文件内容受理', () => {
  it.each(['upload', 'overwrite'] as const)(
    '%s 的写入事实必须等完整 multipart 结束后才返回',
    async (kind) => {
      const request = fixture(kind);
      const consumed = deferred();
      let accepted = false;
      const result = request.start(async (upload) => {
        const result = await upload.writeTo(
          {
            async write(_address, source) {
              const chunks: Uint8Array[] = [];
              for await (const chunk of source) chunks.push(chunk);
              expect(Buffer.concat(chunks)).toEqual(body);
              consumed.resolve();
              return facts;
            },
          },
          address,
          upload.signal,
        );
        accepted = true;
        return result;
      });
      request.sendContent();
      await consumed.promise;
      await setImmediate();
      expect(accepted).toBe(false);
      request.finish();
      await expect(result).resolves.toEqual(facts);
      request.expectReleased();
    },
  );

  it('内容已写完后到达的后置字段仍然拒绝受理', async () => {
    const request = fixture();
    const consumed = deferred();
    const result = request.start((upload) =>
      upload.writeTo(
        {
          async write(_address, source) {
            for await (const chunk of source)
              expect(chunk.byteLength).toBeGreaterThan(0);
            consumed.resolve();
            return facts;
          },
        },
        address,
        upload.signal,
      ),
    );
    const rejected = expect(result).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
      status: 400,
    });
    request.sendContent();
    await consumed.promise;
    request.input.end(
      `\r\nContent-Disposition: form-data; name="unexpected"\r\n\r\nlate\r\n--${boundary}--\r\n`,
    );
    await rejected;
    request.expectReleased();
  });

  it('内容 EOF 后取消仍能结束 multipart 等待并保留原始原因', async () => {
    const request = fixture();
    const operation = new AbortController();
    const reason = new Error('lease lost');
    const consumed = deferred();
    const result = request.start((upload) =>
      upload.writeTo(
        {
          async write(_address, source) {
            for await (const chunk of source)
              expect(chunk.byteLength).toBeGreaterThan(0);
            consumed.resolve();
            return facts;
          },
        },
        address,
        operation.signal,
      ),
    );
    const rejected = expect(result).rejects.toBe(reason);
    request.sendContent();
    await consumed.promise;
    await setImmediate();
    operation.abort(reason);
    await rejected;
    request.finish();
    request.expectReleased();
  });

  it('重放同样等待完整 multipart，并在等待时响应取消', async () => {
    const request = fixture();
    const operation = new AbortController();
    const reason = new Error('physical scope lost');
    let verified = false;
    const result = request.start(async (upload) => {
      await upload.verifyReplay(operation.signal);
      verified = true;
    });
    const rejected = expect(result).rejects.toBe(reason);
    request.sendContent();
    await setImmediate();
    expect(verified).toBe(false);
    operation.abort(reason);
    await rejected;
    request.finish();
    request.expectReleased();
  });

  it('存储尚未消费内容便失败时不等待 multipart 尾部', async () => {
    const request = fixture();
    const failure = new StorageError('STORAGE_UNAVAILABLE');
    const result = request.start((upload) =>
      upload.writeTo(
        { write: () => Promise.reject(failure) },
        address,
        upload.signal,
      ),
    );
    const rejected = expect(result).rejects.toBe(failure);
    request.sendContent();
    await rejected;
    request.finish();
    request.expectReleased();
  });

  it('内容受理成功后到业务回调结束前仍传播客户端断开', async () => {
    const request = fixture();
    const consumed = deferred<AbortSignal>();
    const complete = deferred();
    const result = request.start(async (upload) => {
      await upload.verifyReplay(upload.signal);
      consumed.resolve(upload.signal);
      await complete.promise;
      upload.signal.throwIfAborted();
    });
    const rejected = expect(result).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    request.sendContent();
    request.finish();
    const signal = await consumed.promise;
    expect(signal.aborted).toBe(false);
    request.output.emit('close');
    expect(signal.aborted).toBe(true);
    complete.resolve();
    await rejected;
    request.expectReleased();
  });

  it('受理前的非法请求拒绝回调并释放监听器', async () => {
    const request = fixture();
    let called = false;
    const result = request.start(() => {
      called = true;
      return Promise.resolve();
    });
    const rejected = expect(result).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
      status: 400,
    });
    request.input.end(`--${boundary}--\r\n`);
    await rejected;
    expect(called).toBe(false);
    request.expectReleased();
  });
});
