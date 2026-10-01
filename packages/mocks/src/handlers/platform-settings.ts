import { delay, http, HttpResponse } from "msw"
import {
  UpdatePlatformSettingsSchema,
  type PlatformSettings,
  type PlatformSettingsUpdateResult,
} from "@workspace/contracts"

export type PlatformSettingsScenario =
  | "success"
  | "loading"
  | "slow"
  | "emptyConfiguration"
  | "longText"
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "stale"
  | "rateLimited"

// 每个 Story 独立持有服务端版本；草稿、提交状态及幂等键仍由正式页面管理。
export function createPlatformSettingsHandlers(
  scenario: PlatformSettingsScenario = "success"
) {
  let setting: PlatformSettings = {
    platformDefaultLocale: "zh-CN",
    version: 1,
    supportedLocales: ["zh-CN", "en-US", "ar"],
    environment: "production",
    applicationVersion: "0.0.1",
    smtpConfigured: scenario !== "emptyConfiguration",
  }
  if (scenario === "longText")
    setting = {
      ...setting,
      environment: "staging-".repeat(24),
      applicationVersion: "2026.10.02-".repeat(24),
    }
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      { code, message: code, requestId: "storybook-settings", locale: "zh-CN" },
      { status }
    )
  return [
    http.get("*/api/v1/platform/settings", async () => {
      if (scenario === "loading") await delay("infinite")
      if (scenario === "slow") await delay(700)
      if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
      if (scenario === "forbidden") return failure(403, "FORBIDDEN")
      if (scenario === "unavailable") return failure(503, "AUDIT_UNAVAILABLE")
      return HttpResponse.json(setting)
    }),
    http.patch("*/api/v1/platform/settings", async ({ request }) => {
      const input = UpdatePlatformSettingsSchema.parse(await request.json())
      if (scenario === "rateLimited") return failure(429, "INTERNAL_ERROR")
      if (scenario === "stale") {
        setting = { ...setting, platformDefaultLocale: "ar", version: 2 }
        return failure(409, "VERSION_CONFLICT")
      }
      await delay(500)
      const changed =
        input.platformDefaultLocale !== setting.platformDefaultLocale
      setting = {
        ...setting,
        platformDefaultLocale: input.platformDefaultLocale,
        version: setting.version + Number(changed),
      }
      return HttpResponse.json({
        platformDefaultLocale: setting.platformDefaultLocale,
        version: setting.version,
        changed,
        result: changed ? "succeeded" : "no_change",
        operationId: crypto.randomUUID(),
      } satisfies PlatformSettingsUpdateResult)
    }),
  ]
}
