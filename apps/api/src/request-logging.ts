import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('HTTP');

export function requestLogging(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // 在服务端生成关联 ID，避免将客户端任意 Header 当成可信日志标识。
  const requestId = randomUUID();
  const started = performance.now();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    // 不记录查询串、请求体和认证 Header，避免操作日志携带凭据。
    logger.log({
      event: 'http.request.completed',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - started),
    });
  });
  next();
}
