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
} from "@workspace/contracts/platform"
import {
  LoginLogsQuerySchema,
  PlatformSessionsQuerySchema,
} from "@workspace/contracts/identity-management"
import {
  platformOrganizationActor,
  createPlatformAccessFixture,
  platformUserFixture,
} from "@workspace/mocks"
import { PlatformAccessDeniedPage, PlatformLoginPage } from "../App"
import { authClient } from "../lib/auth-client"
import { PlatformUsersPage, PlatformUserDetailPage } from "./users/pages"
import { PlatformAuditPage } from "./audit/page"
import { PlatformSettingsPage } from "./settings-page"
import { PlatformLoginEventsPage } from "./identity/login-events-page"
import { PlatformSessionsPage } from "./identity/sessions-page"

function StoryDenied() {
  const { t } = useTranslation("auth")
  return (
    <AuthGate client={authClient} restoreTitle={t("platformTitle")}>
      {() => <PlatformAccessDeniedPage />}
    </AuthGate>
  )
}

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
  initialEntry,
}: {
  page: "users" | "audit" | "settings" | "login-events" | "sessions"
  detail?: boolean
  auditor?: boolean
  initialEntry?: string
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
        platformAccess: createPlatformAccessFixture(
          platformOrganizationActor.id,
          auditor
        ),
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
      validateSearch: (search) => PlatformAuditQuerySchema.parse(search),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformAuditPage />
        </main>
      ),
    })
    const loginEvents = createRoute({
      getParentRoute: () => platform,
      path: "login-events",
      validateSearch: (search) => LoginLogsQuerySchema.parse(search),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformLoginEventsPage />
        </main>
      ),
    })
    const sessions = createRoute({
      getParentRoute: () => platform,
      path: "sessions",
      validateSearch: (search) => PlatformSessionsQuerySchema.parse(search),
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <PlatformSessionsPage />
        </main>
      ),
    })
    const denied = createRoute({
      getParentRoute: () => platform,
      path: "access-denied",
      component: StoryDenied,
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
    return createRouter({
      routeTree: root.addChildren([
        platform.addChildren([
          users,
          user,
          audit,
          loginEvents,
          sessions,
          settings,
          denied,
        ]),
        login,
      ]),
      history: createMemoryHistory({
        initialEntries: [
          initialEntry ??
            (page === "settings"
              ? "/platform/settings"
              : page === "login-events"
                ? "/platform/login-events"
                : page === "sessions"
                  ? "/platform/sessions"
                  : page === "audit"
                    ? "/platform/audit-events"
                    : detail
                      ? `/platform/users/${platformUserFixture.userId}`
                      : "/platform/users"),
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
