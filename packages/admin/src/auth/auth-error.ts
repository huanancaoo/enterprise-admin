export type AuthClientError = {
  code?: string | undefined
  status?: number | undefined
  message?: string | undefined
  originalMessage?: string | undefined
}

/**
 * 认证错误文案由 Better Auth i18n 插件在服务端写进 error.message。
 * 没有可展示文案时使用调用方提供的通用失败提示，界面不能渲染空错误。
 */
export function authErrorMessage(
  error: AuthClientError,
  fallback: string
): string {
  return error.message?.trim() || fallback
}
