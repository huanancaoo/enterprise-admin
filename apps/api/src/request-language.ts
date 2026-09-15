import type { NextFunction, Request, Response } from 'express';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';
import { resolveLocale, type SupportedLocale } from '@workspace/i18n';

export class RequestLanguage {
  private preferredLocale?: string | null;
  private defaultLocale?: string;

  constructor(private readonly acceptLanguage: string | null | undefined) {}

  get locale(): SupportedLocale {
    return resolveLocale({
      acceptLanguage: this.acceptLanguage,
      preferredLocale: this.preferredLocale,
      defaultLocale: this.defaultLocale,
    });
  }

  // 授权链只在对应身份事实验证成功后补充偏好，失败响应沿用已到达的阶段。
  useUserPreference(locale: string | null | undefined): void {
    this.preferredLocale = locale;
  }

  useOrganizationDefault(locale: string): void {
    this.defaultLocale = locale;
  }

  writeTo(response: Response): SupportedLocale {
    const locale = this.locale;
    response.setHeader('Content-Language', locale);
    return locale;
  }
}

export function getRequestLanguage(response: Response): RequestLanguage {
  return response.locals.language as RequestLanguage;
}

export class RequestLanguageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      // 成功返回时授权已经完成；异常路径由错误处理读取同一份请求语言。
      tap(() => getRequestLanguage(response).writeTo(response)),
    );
  }
}

export function requestLanguage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // 登录和组织校验完成前，只使用请求语言；授权链逐步补充已验证身份的偏好。
  res.locals.language = new RequestLanguage(req.get('accept-language'));
  if (req.path.startsWith('/api/v1')) {
    // 表示还可能依赖会话与组织偏好，业务响应不进入共享缓存。
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
