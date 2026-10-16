import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiErrorCodeSchema,
  type ApiError,
  type ApiErrorCode,
} from '@workspace/contracts';
import { getTranslator } from '@workspace/i18n/server';
import { getRequestLanguage } from './request-language';
import { ApiException } from './api-exception';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = apiFailureStatus(error);
    const code = apiFailureCode(error);
    const locale = getRequestLanguage(response).writeTo(response);
    const requestId = response.locals.requestId as string;
    if (status >= 500)
      this.logger.error({
        event: 'api.request.failed',
        requestId,
        code,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    const body: ApiError = {
      code,
      message: getTranslator(locale)(code),
      requestId,
      locale,
      ...(error instanceof ApiException && error.details
        ? { details: error.details }
        : {}),
    };
    response.status(status).json(body);
  }
}

export function apiFailureCode(error: unknown): ApiErrorCode {
  const status = apiFailureStatus(error);
  const codes: Record<number, ApiErrorCode> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHENTICATED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    413: 'VALIDATION_ERROR',
  };
  return declaredCode(error) ?? codes[status] ?? 'INTERNAL_ERROR';
}

function apiFailureStatus(error: unknown): number {
  if (error instanceof HttpException) return error.getStatus();
  // body-parser 的容量拒绝发生在 Controller 前，不能被报告成业务执行故障。
  if (
    error instanceof Error &&
    Reflect.get(error, 'type') === 'entity.too.large' &&
    Reflect.get(error, 'status') === 413
  )
    return 413;
  return 500;
}

function declaredCode(error: unknown): ApiErrorCode | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  if (typeof body !== 'object' || body === null || !('code' in body))
    return undefined;
  const parsed = ApiErrorCodeSchema.safeParse(body.code);
  return parsed.success ? parsed.data : undefined;
}
