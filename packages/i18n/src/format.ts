import type { SupportedLocale } from "./index.js"

// 时区与币种由调用方明确提供，语言切换不会替用户更换业务时区或币种。
export function createFormatter(locale: SupportedLocale) {
  return {
    number: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(value),
    percent: (
      value: number,
      options?: Omit<Intl.NumberFormatOptions, "style">
    ) =>
      new Intl.NumberFormat(locale, { ...options, style: "percent" }).format(
        value
      ),
    currency: (
      value: number,
      currency: string,
      options?: Omit<Intl.NumberFormatOptions, "style" | "currency">
    ) =>
      new Intl.NumberFormat(locale, {
        ...options,
        style: "currency",
        currency,
      }).format(value),
    dateTime: (
      value: Date | number,
      timeZone: string,
      options?: Omit<Intl.DateTimeFormatOptions, "timeZone">
    ) =>
      new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(value),
    relativeTime: (
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions
    ) => new Intl.RelativeTimeFormat(locale, options).format(value, unit),
  }
}
