import type { NextFunction, Request, Response } from 'express';
import { resolveLocale, type SupportedLocale } from '@workspace/i18n';

export interface RequestLanguage {
  locale: SupportedLocale;
}

export function requestLanguage(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // 登录和组织校验完成前，只使用请求语言；授权链逐步补充已验证身份的偏好。
  res.locals.language = {
    locale: resolveLocale({ acceptLanguage: req.get('accept-language') }),
  } satisfies RequestLanguage;
  if (req.path.startsWith('/api/v1')) {
    // 表示还可能依赖会话与组织偏好，业务响应不进入共享缓存。
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}
