import { randomUUID } from 'node:crypto';
import { mkdtemp, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readAnnouncementUpload } from './announcement-upload';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});

type Part =
  | { field: string; name: string; mimeType: string; content: Buffer }
  | { field: string; value: string };

function multipart(parts: Part[], closed = true): Request {
  const boundary = `announcement-${randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if ('value' in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.field}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.field}"; filename="${part.name}"\r\nContent-Type: ${part.mimeType}\r\n\r\n`,
        ),
        part.content,
        Buffer.from('\r\n'),
      );
    }
  }
  if (closed) chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Object.assign(Readable.from(chunks), {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }) as unknown as Request;
}

function file(content: Buffer, mimeType = 'application/pdf'): Part {
  return { field: 'file', name: 'notice.pdf', mimeType, content };
}

async function bytes(source: AsyncIterable<Uint8Array>) {
  const chunks: Buffer[] = [];
  for await (const chunk of source) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 20, g: 70, b: 100, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
});

afterEach(async () => {
  // 记录真实 mkdtemp 调用，确保所有成功或失败分支均由产品逻辑清理临时目录。
  for (const result of vi.mocked(mkdtemp).mock.results) {
    if (result.type !== 'return') continue;
    const directory = await result.value;
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  }
  vi.mocked(mkdtemp).mockClear();
});

describe('公告 multipart 上传输入', () => {
  it('保留附件的实际字节和元信息，dispose 删除临时内容', async () => {
    const content = Buffer.from('%PDF-1.7\nprivate notice\n');
    const upload = await readAnnouncementUpload(multipart([file(content)]));
    expect(upload).toMatchObject({
      name: 'notice.pdf',
      mimeType: 'application/pdf',
      bytes: content.length,
    });
    await expect(bytes(upload.source)).resolves.toEqual(content);
    await upload.dispose();
  });

  it('允许可完整解码且 MIME 匹配的 PNG', async () => {
    const upload = await readAnnouncementUpload(
      multipart([file(png, 'image/png')]),
    );
    await expect(bytes(upload.source)).resolves.toEqual(png);
    await upload.dispose();
  });

  it.each([
    ['验收.txt', 'text/plain'],
    ['中文头像.png', 'image/png'],
  ])('按 UTF-8 保留浏览器上传的中文文件名 %s', async (name, mimeType) => {
    const content = mimeType === 'image/png' ? png : Buffer.from('验收内容');
    const upload = await readAnnouncementUpload(
      multipart([{ ...file(content, mimeType), name }]),
    );
    expect(upload.name).toBe(name);
    expect(upload.mimeType).toBe(mimeType);
    await expect(bytes(upload.source)).resolves.toEqual(content);
    await upload.dispose();
  });

  it.each([
    ['无文件', () => multipart([])],
    ['空文件', () => multipart([file(Buffer.alloc(0))])],
    [
      '错误字段名',
      () => multipart([{ ...file(Buffer.from('content')), field: 'avatar' }]),
    ],
    [
      '额外文本字段',
      () =>
        multipart([
          file(Buffer.from('content')),
          { field: 'organizationId', value: randomUUID() },
        ]),
    ],
    [
      '重复文件',
      () =>
        multipart([file(Buffer.from('first')), file(Buffer.from('second'))]),
    ],
    [
      '伪 PNG',
      () => multipart([file(Buffer.from('<script>bad</script>'), 'image/png')]),
    ],
    ['图片 MIME 不符', () => multipart([file(png, 'image/jpeg')])],
    ['损坏图片', () => multipart([file(png.subarray(0, 24), 'image/png')])],
    [
      'SVG 主动内容',
      () =>
        multipart([
          file(
            Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
            ),
            'image/svg+xml',
          ),
        ]),
    ],
    [
      '不完整 multipart',
      () => multipart([file(Buffer.from('partial'))], false),
    ],
  ])('拒绝%s并清理临时文件', async (_name, request) => {
    await expect(readAnnouncementUpload(request())).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
      status: 400,
    });
  });

  it('拒绝缺少 multipart Content-Type 的请求并清理临时目录', async () => {
    const request = Object.assign(Readable.from([Buffer.from('body')]), {
      headers: {},
    }) as unknown as Request;
    await expect(readAnnouncementUpload(request)).rejects.toMatchObject({
      response: { code: 'VALIDATION_ERROR' },
    });
  });

  it('图片超过 5 MiB 时在解码前拒绝并清理临时文件', async () => {
    await expect(
      readAnnouncementUpload(
        multipart([file(Buffer.alloc(5 * 1024 ** 2 + 1), 'image/png')]),
      ),
    ).rejects.toMatchObject({
      response: { code: 'FILE_TOO_LARGE' },
      status: 413,
    });
  });
});
