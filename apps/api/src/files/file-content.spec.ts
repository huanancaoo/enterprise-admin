import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { contentDisposition } from './file-content';

describe('文件内容 HTTP 策略', () => {
  it('Unicode 文件名只发送标准 UTF-8 参数，不产生 ASCII 替代名', () => {
    expect(
      contentDisposition('报告 !*().pdf', 'application/pdf', 'attachment'),
    ).toBe("attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A%20!%2A%28%29.pdf");
    expect(
      contentDisposition('café.pdf', 'application/pdf', 'attachment'),
    ).toBe("attachment; filename*=UTF-8''caf%C3%A9.pdf");
  });

  it('标准库处理 ASCII 名称里的引号、分号与百分号', () => {
    expect(
      contentDisposition('draft "1"; 100%.txt', 'text/plain', 'attachment'),
    ).toBe('attachment; filename="draft \\"1\\"; 100%.txt"');
  });

  it.each([
    'image/png',
    'application/pdf',
    ' Text/Plain; charset=utf-8',
    'application/json',
    'audio/mpeg',
    'video/mp4',
  ])('已有预览类型 %s 保留 inline', (mime) => {
    expect(contentDisposition('preview', mime, 'inline')).toBe(
      'inline; filename=preview',
    );
  });

  it.each([
    'text/html',
    'image/svg+xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ])('%s 只能下载，不能以 inline 放宽白名单', (mime) => {
    expect(() => contentDisposition('file', mime, 'inline')).toThrow(
      BadRequestException,
    );
    expect(contentDisposition('file', mime, 'attachment')).toBe(
      'attachment; filename=file',
    );
  });
});
