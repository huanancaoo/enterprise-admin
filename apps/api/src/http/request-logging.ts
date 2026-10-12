import { randomUUID } from 'node:crypto';
import { beginHttpRequest, operationalLogger } from '@workspace/observability';
import type { IRoute, NextFunction, Request, Response } from 'express';

export function requestLogging(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // 在服务端生成关联 ID，避免将客户端任意 Header 当成可信日志标识。
  const requestId = randomUUID();
  const started = performance.now();
  const observation = beginHttpRequest(requestId, req.method);
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  res.once('finish', () => {
    // 不记录查询串、请求体和认证 Header，避免操作日志携带凭据。
    const route = req.route as IRoute | undefined;
    const identifiers = observation.finish(
      res.statusCode,
      String(route?.path ?? 'unmatched'),
    );
    operationalLogger.info({
      event: 'http.request.completed',
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      ...identifiers,
    });
  });
  observation.run(next);
}
