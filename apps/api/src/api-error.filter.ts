import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError, ApiErrorCode } from '@workspace/contracts';
import { getTranslator } from '@workspace/i18n';
import type { RequestLanguage } from './request-language';

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const codes: Record<number, ApiErrorCode> = {
      400: 'VALIDATION_ERROR',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
    };
    const code = codes[status] ?? 'INTERNAL_ERROR';
    const { locale } = response.locals.language as RequestLanguage;
    const requestId = response.locals.requestId as string;
    if (status >= 500)
      this.logger.error({ event: 'api.request.failed', requestId, error });
    const body: ApiError = {
      code,
      message: getTranslator(locale)(code),
      requestId,
      locale,
    };
    response.setHeader('Content-Language', locale);
    response.status(status).json(body);
  }
}
