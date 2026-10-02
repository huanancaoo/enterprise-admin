import type { QueryExecutor } from "./organization-status.ts"
import type { SupportedLocale } from "@workspace/i18n/locale"

export async function readPlatformDefaultLocale(
  pool: QueryExecutor
): Promise<SupportedLocale> {
  const result = await pool.query<{ default_locale: SupportedLocale }>(
    "SELECT default_locale FROM public.platform_settings WHERE singleton = true"
  )
  // 迁移建立唯一事实；缺失不能静默恢复为代码常量，掩盖部署或数据问题。
  if (!result.rows[0]) throw new Error("Platform locale setting is missing")
  return result.rows[0].default_locale
}
