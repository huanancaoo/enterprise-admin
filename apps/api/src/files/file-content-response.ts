import { StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { measuredContent, type StoredRead } from './storage/storage';

export function streamFileContent(
  result: {
    version: { contentType: string };
    read: StoredRead;
    dispositionHeader: string;
  },
  response: Response,
): StreamableFile {
  const { version, read, dispositionHeader } = result;
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Accept-Ranges', 'bytes');
  if (read.range) {
    response.status(206);
    response.setHeader(
      'Content-Range',
      `bytes ${read.range.start}-${read.range.end}/${read.totalBytes}`,
    );
  }
  const stream = Readable.from(measuredContent(read.body, read.bytes).stream);
  response.once('close', () => {
    stream.destroy();
    read.body.destroy();
  });
  stream.once('close', () => read.body.destroy());
  // open 等待期间也可能已断连；close 事件不会为后注册的监听器重放。
  if (response.destroyed) {
    stream.destroy();
    read.body.destroy();
  }
  return new StreamableFile(stream, {
    type: version.contentType,
    length: read.bytes,
    disposition: dispositionHeader,
  }).setErrorHandler(() => {
    // 响应开始后只能断开连接；JSON 错误或正常结束会把截断内容伪装成成功。
    response.destroy();
    read.body.destroy();
  });
}
