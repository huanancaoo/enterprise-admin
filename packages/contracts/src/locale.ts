import { z } from "zod"

export const SupportedLocaleSchema = z
  .enum(["zh-CN", "en-US", "ar"])
  .meta({ id: "SupportedLocale" })
export const LocaleSourceSchema = z
  .enum(["request", "user", "organization", "platform"])
  .meta({ id: "LocaleSource" })
export const InheritedLocaleSourceSchema = z
  .enum(["user", "organization", "platform"])
  .meta({ id: "InheritedLocaleSource" })
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>
