import type { LoggerService } from '@nestjs/common';
import { operationalLogger } from '@workspace/observability';

function diagnostic(event: string, message: unknown, context?: string) {
  const result: Record<string, string | undefined> = { event, context };
  // ORM 和 HTTP 中间件错误可携带 SQL 参数或原始请求体；运行日志只接收关联与诊断元数据。
  if (message !== null && typeof message === 'object') {
    for (const key of [
      'event',
      'code',
      'errorCode',
      'errorType',
      'requestId',
      'traceId',
      'spanId',
    ]) {
      const value: unknown = Reflect.get(message, key);
      if (typeof value === 'string') result[key] = value;
    }
    if (message instanceof Error) result.errorType = message.name;
  }
  return result;
}
export const operationalNestLogger: LoggerService = {
  log(message: unknown, context?: string) {
    operationalLogger.info(diagnostic('application.log', message, context));
  },
  warn(message: unknown, context?: string) {
    operationalLogger.warn(diagnostic('application.warning', message, context));
  },
  error(message: unknown, _stack?: string, context?: string) {
    operationalLogger.error(diagnostic('application.error', message, context));
  },
  debug(message: unknown, context?: string) {
    operationalLogger.debug(diagnostic('application.debug', message, context));
  },
  verbose(message: unknown, context?: string) {
    operationalLogger.trace(
      diagnostic('application.verbose', message, context),
    );
  },
  fatal(message: unknown, context?: string) {
    operationalLogger.fatal(diagnostic('application.fatal', message, context));
  },
};
