import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';
import sharp from 'sharp';
import type { Request } from 'express';
import { ApiException } from '../http/api-exception';

const maximumBytes = 100 * 1024 ** 2;
const imageTypes = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;

export async function readAnnouncementUpload(request: Request) {
  const directory = await mkdtemp(join(tmpdir(), 'enterprise-announcement-'));
  const path = join(directory, 'content');
  const dispose = () => rm(directory, { recursive: true, force: true });
  let name = '';
  let mimeType = '';
  let bytes = 0;
  let invalid = false;
  let tooLarge = false;
  let seen = false;
  const writes: Promise<void>[] = [];
  try {
    const parser = busboy({
      headers: request.headers,
      defParamCharset: 'utf8',
      limits: { files: 1, fields: 0, parts: 2, fileSize: maximumBytes + 1 },
    });
    parser.on('file', (field, stream, info) => {
      if (field !== 'file' || seen) {
        invalid = true;
        stream.resume();
        return;
      }
      seen = true;
      name = info.filename;
      mimeType = info.mimeType;
      stream.on('limit', () => {
        tooLarge = true;
      });
      writes.push(
        (async () => {
          const file = await open(path, 'wx');
          try {
            for await (const value of stream) {
              const chunk = Buffer.from(value as Uint8Array);
              bytes += chunk.length;
              if (bytes <= maximumBytes) await file.writeFile(chunk);
              else tooLarge = true;
            }
          } finally {
            await file.close();
          }
        })(),
      );
    });
    parser.on('fieldsLimit', () => {
      invalid = true;
    });
    parser.on('filesLimit', () => {
      invalid = true;
    });
    parser.on('partsLimit', () => {
      invalid = true;
    });
    await pipeline(request, parser);
    await Promise.all(writes);
    if (tooLarge) throw new ApiException(413, 'FILE_TOO_LARGE');
    if (invalid || !seen || bytes === 0)
      throw new ApiException(400, 'VALIDATION_ERROR');
    if (mimeType.startsWith('image/')) {
      // 图片必须实际解码，不能凭扩展名或 multipart MIME 把主动内容当作可内联图片。
      if (bytes > 5 * 1024 ** 2) throw new ApiException(413, 'FILE_TOO_LARGE');
      const decoder = sharp(path, { animated: true, failOn: 'warning' });
      try {
        const metadata = await decoder.metadata();
        if (
          !(metadata.format in imageTypes) ||
          imageTypes[metadata.format as keyof typeof imageTypes] !== mimeType
        ) {
          throw new ApiException(400, 'VALIDATION_ERROR');
        }
        await decoder.raw().toBuffer();
      } finally {
        decoder.destroy();
      }
    }
    return { name, mimeType, bytes, source: createReadStream(path), dispose };
  } catch (error) {
    await Promise.allSettled(writes);
    await dispose();
    if (error instanceof ApiException) throw error;
    throw new ApiException(400, 'VALIDATION_ERROR');
  }
}
