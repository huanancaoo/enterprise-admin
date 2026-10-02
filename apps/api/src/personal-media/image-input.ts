import { BadRequestException } from '@nestjs/common';
import { personalMediaMaximumBytes } from '@workspace/contracts';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import sharp from 'sharp';
import { ApiException } from '../http/api-exception';

const imageTypes = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
} as const;

export async function readImage(request: Request, signal: AbortSignal) {
  const type = request.get('content-type')?.split(';', 1)[0].toLowerCase();
  if (!Object.values(imageTypes).some((value) => value === type))
    throw new BadRequestException();
  const chunks: Buffer[] = [];
  let bytes = 0;
  // 最多保留 5 MiB；超额部分只排空 HTTP 正文，保证客户端收到完整 413 而非连接重置。
  for await (const value of request.iterator({ destroyOnReturn: false })) {
    signal.throwIfAborted();
    const data: unknown = value;
    if (!(data instanceof Uint8Array)) throw new BadRequestException();
    const chunk = Buffer.from(data);
    bytes += chunk.length;
    if (bytes <= personalMediaMaximumBytes) chunks.push(chunk);
  }
  if (bytes > personalMediaMaximumBytes)
    throw new ApiException(413, 'FILE_TOO_LARGE', {
      maximumBytes: personalMediaMaximumBytes,
    });
  signal.throwIfAborted();
  if (bytes === 0) throw new BadRequestException();
  const body = Buffer.concat(chunks, bytes);
  const decoder = sharp(body, { animated: true, failOn: 'warning' });
  const abort = () => decoder.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    const metadata = await decoder.metadata();
    if (!(metadata.format in imageTypes)) throw new BadRequestException();
    const contentType = imageTypes[metadata.format as keyof typeof imageTypes];
    if (contentType !== type) throw new BadRequestException();
    // metadata 只读头；全部动画帧实际解码成像素后才允许创建持久上传计划。
    await decoder.raw().toBuffer();
    signal.throwIfAborted();
    return {
      body,
      bytes,
      contentType,
      sha256: createHash('sha256').update(body).digest('hex'),
    };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException();
  } finally {
    signal.removeEventListener('abort', abort);
    decoder.destroy();
  }
}
