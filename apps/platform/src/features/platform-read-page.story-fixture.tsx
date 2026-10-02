import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { AuthGate, AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  PlatformAuditQuerySchema,
  PlatformUsersQuerySchema,
} from "@workspace/contracts"
import {
  platformOrganizationActor,
  platformUserFixture,
} from "@workspace/mocks"
import {
  PlatformAccessDeniedPage,
  PlatformLoginPage,
  PlatformMfaPage,
} from "../App"
import { authClient } from "../lib/auth-client"
import { PlatformUsersPage, PlatformUserDetailPage } from "./users/pages"
import { PlatformAuditPage } from "./audit/page"
import { PlatformSettingsPage } from "./settings-page"

function StoryLogin() {
  const { t } = useTranslation("auth")
  return (
    <AuthGate client={authClient} restoreTitle={t("platformTitle")}>
      {() => <PlatformLoginPage />}
    </AuthGate>
  )
}

export function PlatformReadPageStory({
  page,
  detail = false,
  auditor = false,
}: {
  page: "users" | "audit" | "settings"
  detail?: boolean
  auditor?: boolean
}) {
  const [router] = useState(() => {
    const root = createRootRoute({
      beforeLoad: () => ({
        user: { ...platformOrganizationActor, twoFactorEnabled: true },
      }),
    })
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      beforeLoad: () => ({
        platformAccess: {
          userId: platformOrganizationActor.id,
          role: auditor ? "platform_auditor" : "platform_admin",
          scope: "global",
          mfaVerifiedAt: "2026-10-02T00:00:00.000Z",
        },
      }),
      component: Outlet,
    })
    const users = createRoute({
      getParentRoute: () => platform,
      path: "users",
      validateSearch: (search) => PlatformUsersQuerySchema.parse(search),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformUsersPage />
        </main>
      ),
    })
    const user = createRoute({
      getParentRoute: () => platform,
      path: "users/$userId",
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformUserDetailPage />
        </main>
      ),
    })
    const audit = createRoute({
      getParentRoute: () => platform,
      path: "audit-events",
      validateSearch: (search) =>
        PlatformAuditQuerySchema.omit({ purpose: true, cursor: true }).parse(
          search
        ),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformAuditPage />
        </main>
      ),
    })
    const denied = createRoute({
      getParentRoute: () => platform,
      path: "access-denied",
      component: PlatformAccessDeniedPage,
    })
    const login = createRoute({
      getParentRoute: () => root,
      path: "login",
      component: StoryLogin,
    })
    const settings = createRoute({
      getParentRoute: () => platform,
      path: "settings",
      component: () => (
        <main className="mx-auto max-w-5xl p-6">
          <PlatformSettingsPage />
        </main>
      ),
    })
    const mfa = createRoute({
      getParentRoute: () => platform,
      path: "mfa",
      validateSearch: (search) => ({ challenge: search.challenge === true }),
      component: PlatformMfaPage,
    })
    return createRouter({
      routeTree: root.addChildren([
        platform.addChildren([users, user, audit, settings, mfa, denied]),
        login,
      ]),
      history: createMemoryHistory({
        initialEntries: [
          page === "settings"
            ? "/platform/settings"
            : page === "audit"
              ? "/platform/audit-events"
              : detail
                ? `/platform/users/${platformUserFixture.userId}`
                : "/platform/users",
        ],
      }),
    })
  })
  // 身份与平台任职为 UI fixture；内容查询、错误跳转和表单运行正式页面。
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}
