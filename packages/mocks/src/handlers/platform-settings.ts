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
  | "retryable"
  | "stale"
  | "rateLimited"
  | "saveUnavailable"
  | "saveLoading"
  | "saveForbidden"
  | "saveUnauthorized"
  | "mfaRequired"

export function createPlatformSettingsScenario(
  scenario: PlatformSettingsScenario = "success"
) {
  const initial: PlatformSettings = {
    platformDefaultLocale: "zh-CN",
    version: 1,
    supportedLocales: ["zh-CN", "en-US", "ar"],
    environment: scenario === "longText" ? "staging-".repeat(24) : "production",
    applicationVersion:
      scenario === "longText" ? "2026.10.02-".repeat(24) : "0.0.1",
    smtpConfigured: scenario !== "emptyConfiguration",
  }
  let setting = structuredClone(initial)
  let failedRead = false
  let failedSave = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      { code, message: code, requestId: "storybook-settings", locale: "en-US" },
      { status }
    )
  return {
    // 重跑同一 Story 也从原版本开始，保存和冲突不能污染下一次渲染。
    reset: () => {
      setting = structuredClone(initial)
      failedRead = false
      failedSave = false
    },
    handlers: [
      http.get("*/api/v1/platform/settings", async () => {
        if (scenario === "loading") await delay("infinite")
        if (scenario === "slow") await delay(700)
        if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
        if (scenario === "forbidden") return failure(403, "FORBIDDEN")
        if (scenario === "unavailable") return failure(503, "AUDIT_UNAVAILABLE")
        if (scenario === "retryable" && !failedRead) {
          failedRead = true
          return failure(503, "AUDIT_UNAVAILABLE")
        }
        return HttpResponse.json(setting)
      }),
      http.patch("*/api/v1/platform/settings", async ({ request }) => {
        const input = UpdatePlatformSettingsSchema.parse(await request.json())
        if (scenario === "saveLoading") await delay("infinite")
        if (scenario === "saveForbidden") return failure(403, "FORBIDDEN")
        if (scenario === "saveUnauthorized")
          return failure(401, "UNAUTHENTICATED")
        if (scenario === "mfaRequired")
          return failure(403, "PLATFORM_MFA_REQUIRED")
        if (
          !failedSave &&
          (scenario === "rateLimited" || scenario === "saveUnavailable")
        ) {
          failedSave = true
          return failure(
            scenario === "rateLimited" ? 429 : 503,
            scenario === "rateLimited" ? "INTERNAL_ERROR" : "AUDIT_UNAVAILABLE"
          )
        }
        if (scenario === "stale" && !failedSave) {
          failedSave = true
          setting = { ...setting, platformDefaultLocale: "ar", version: 2 }
          return failure(409, "VERSION_CONFLICT")
        }
        if (input.expectedVersion !== setting.version)
          return failure(409, "VERSION_CONFLICT")
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
    ],
  }
}
