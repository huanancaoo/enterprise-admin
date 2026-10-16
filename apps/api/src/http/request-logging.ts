import { randomUUID } from 'node:crypto';
import { beginHttpRequest, operationalLogger } from '@workspace/observability';
import type { IRoute, NextFunction, Request, Response } from 'express';
import onFinished from 'on-finished';

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
  onFinished(res, (error) => {
    // close 可在没有错误对象时发生；只有完整写出的响应才能算 completed。
    const outcome = error
      ? 'error'
      : res.writableFinished
        ? 'completed'
        : 'aborted';
    const statusCode = res.headersSent ? res.statusCode : undefined;
    // 不记录查询串、请求体和认证 Header，避免操作日志携带凭据。
    const route = req.route as IRoute | undefined;
    const identifiers = observation.finish(
      statusCode,
      String(route?.path ?? 'unmatched'),
      outcome,
    );
    operationalLogger.info({
      event: `http.request.${outcome}`,
      requestId,
      method: req.method,
      path: req.path,
      statusCode,
      durationMs: Math.round(performance.now() - started),
      ...identifiers,
    });
  });
  observation.run(next);
}
