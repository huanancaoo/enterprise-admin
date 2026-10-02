import { delay, http, HttpResponse } from "msw"
import {
  UpdateMyPreferencesSchema,
  UpdateOrganizationSettingsSchema,
  type MyPreferences,
  type OrganizationAccess,
  type OrganizationSettings,
} from "@workspace/contracts"
import { organizations } from "../fixtures/projects"

export const localeSettingsUser = {
  id: "c7dd0a27-4f8a-4aef-8d4c-000000005001",
  name: "Language editor",
  email: "language-editor@example.test",
}
export type LocaleSettingsTarget = "personal" | "organization"
export type LocaleSettingsScenario =
  | "success"
  | "loading"
  | "slow"
  | "empty"
  | "unavailable"
  | "forbidden"
  | "unauthorized"
  | "readOnly"
  | "permissionUnavailable"
  | "saveLoading"
  | "saveUnavailable"
  | "rateLimited"
  | "stale"
  | "saveForbidden"
  | "saveUnauthorized"
  | "inheritOrganization"
  | "inheritPlatform"
  | "noOrganization"
  | "refreshUnavailable"
  | "organizationUnavailable"
  | "organizationLoading"

export function createLocaleSettingsScenario(
  target: LocaleSettingsTarget,
  scenario: LocaleSettingsScenario = "success"
) {
  const organizationId = organizations[0].id
  const hasOrganization = scenario !== "noOrganization"
  const platformLocale = ["inheritPlatform", "noOrganization"].includes(
    scenario
  )
    ? "ar"
    : "zh-CN"
  const initialPreferences: MyPreferences = {
    preferredLocale: scenario === "empty" ? null : "en-US",
    version: 1,
    effectiveLocale: scenario === "empty" ? platformLocale : "en-US",
    effectiveLocaleSource: scenario === "empty" ? "platform" : "user",
  }
  const initialSettings: OrganizationSettings = {
    organizationId,
    defaultLocale:
      scenario === "empty" || scenario === "inheritPlatform"
        ? null
        : scenario === "inheritOrganization"
          ? "ar"
          : "en-US",
    version: 1,
  }
  let preferences = structuredClone(initialPreferences)
  let settings = structuredClone(initialSettings)
  let failedSave = false
  let saved = false
  const failure = (status: number, code: string) =>
    HttpResponse.json(
      { code, message: code, requestId: "storybook-locale", locale: "en-US" },
      { status }
    )
  const readFailure = async (current: LocaleSettingsTarget) => {
    if (target !== current) return
    if (scenario === "loading") await delay("infinite")
    if (scenario === "slow") await delay(700)
    if (scenario === "unavailable") return failure(503, "INTERNAL_ERROR")
    if (scenario === "forbidden") return failure(403, "FORBIDDEN")
    if (scenario === "unauthorized") return failure(401, "UNAUTHENTICATED")
  }
  const saveFailure = async () => {
    if (scenario === "saveLoading") await delay("infinite")
    if (scenario === "saveForbidden") return failure(403, "FORBIDDEN")
    if (scenario === "saveUnauthorized") return failure(401, "UNAUTHENTICATED")
    if (!failedSave && ["rateLimited", "saveUnavailable"].includes(scenario)) {
      failedSave = true
      return failure(scenario === "rateLimited" ? 429 : 503, "INTERNAL_ERROR")
    }
    if (scenario === "stale" && !failedSave) {
      failedSave = true
      if (target === "personal") {
        preferences = {
          ...preferences,
          preferredLocale: "zh-CN",
          effectiveLocale: "zh-CN",
          version: 2,
        }
      } else settings = { ...settings, defaultLocale: "zh-CN", version: 2 }
      return failure(409, "VERSION_CONFLICT")
    }
  }
  return {
    // 版本冲突和手动重试消费同一事实，重跑场景恢复最初设置。
    reset: () => {
      preferences = structuredClone(initialPreferences)
      settings = structuredClone(initialSettings)
      failedSave = false
      saved = false
    },
    handlers: [
      http.get("*/api/auth/get-session", () =>
        HttpResponse.json({
          user: { ...localeSettingsUser, emailVerified: true },
          session: {
            id: "locale-session",
            userId: localeSettingsUser.id,
            activeOrganizationId: hasOrganization ? organizationId : null,
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        })
      ),
      http.get("*/api/auth/organization/get-full-organization", async () => {
        if (scenario === "organizationLoading") await delay("infinite")
        if (scenario === "organizationUnavailable")
          return failure(503, "INTERNAL_ERROR")
        return HttpResponse.json(
          hasOrganization
            ? {
                ...organizations[0],
                slug: "north",
                createdAt: "2026-09-01T00:00:00.000Z",
                members: [],
                invitations: [],
              }
            : null
        )
      }),
      http.post(
        "*/api/auth/organization/has-permission",
        async ({ request }) => {
          if (scenario === "permissionUnavailable")
            return failure(503, "INTERNAL_ERROR")
          const body = (await request.json()) as {
            organizationId: string
            permissions: { tenantSettings: string[] }
          }
          return HttpResponse.json({
            success:
              body.organizationId === organizationId &&
              scenario !== "forbidden" &&
              (scenario !== "readOnly" ||
                !body.permissions.tenantSettings.includes("update")),
          })
        }
      ),
      http.get(
        "*/api/v1/me/preferences",
        async () =>
          (await readFailure("personal")) ?? HttpResponse.json(preferences)
      ),
      http.patch("*/api/v1/me/preferences", async ({ request }) => {
        const input = UpdateMyPreferencesSchema.parse(await request.json())
        const rejected = await saveFailure()
        if (rejected) return rejected
        if (input.expectedVersion !== preferences.version)
          return failure(409, "VERSION_CONFLICT")
        await delay(500)
        // 本人偏好响应给出无请求头的继承结果；组织继承由 access 响应另外提供。
        preferences = {
          preferredLocale: input.preferredLocale,
          version: preferences.version + 1,
          effectiveLocale: input.preferredLocale ?? platformLocale,
          effectiveLocaleSource: input.preferredLocale ? "user" : "platform",
        }
        saved = true
        return HttpResponse.json(preferences)
      }),
      http.get(
        "*/api/v1/organizations/:organizationId/settings",
        async ({ params }) => {
          if (params.organizationId !== organizationId)
            return failure(403, "FORBIDDEN")
          return (
            (await readFailure("organization")) ?? HttpResponse.json(settings)
          )
        }
      ),
      http.patch(
        "*/api/v1/organizations/:organizationId/settings",
        async ({ params, request }) => {
          if (
            params.organizationId !== organizationId ||
            scenario === "readOnly"
          )
            return failure(403, "FORBIDDEN")
          const input = UpdateOrganizationSettingsSchema.parse(
            await request.json()
          )
          const rejected = await saveFailure()
          if (rejected) return rejected
          if (input.expectedVersion !== settings.version)
            return failure(409, "VERSION_CONFLICT")
          await delay(500)
          settings = {
            ...settings,
            defaultLocale: input.defaultLocale,
            version: settings.version + 1,
          }
          return HttpResponse.json(settings)
        }
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/access",
        ({ params }) => {
          if (params.organizationId !== organizationId)
            return failure(403, "FORBIDDEN")
          if (scenario === "refreshUnavailable" && saved)
            return failure(503, "INTERNAL_ERROR")
          return HttpResponse.json({
            organizationId,
            status: "ACTIVE",
            authorizationVersion: 1,
            effectiveLocale:
              preferences.preferredLocale ??
              settings.defaultLocale ??
              platformLocale,
            effectiveLocaleSource: preferences.preferredLocale
              ? "user"
              : settings.defaultLocale
                ? "organization"
                : "platform",
          } satisfies OrganizationAccess)
        }
      ),
    ],
  }
}
