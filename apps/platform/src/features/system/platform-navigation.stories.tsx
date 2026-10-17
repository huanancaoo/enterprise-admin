import { useTranslation } from "react-i18next"
import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { NavMain } from "@workspace/admin"
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import {
  createHiddenPlatformFrameHandler,
  createWorkspaceSessionHandlers,
  hiddenPlatformFrameId,
  hiddenPlatformFrameUrl,
  platformOrganizationActor,
} from "@workspace/mocks"
import { authClient } from "../../lib/auth-client"
import { usePlatformNavigation } from "./use-platform-navigation"
import { PlatformEmbeddedPage } from "./platform-navigation"

function NavigationShell() {
  const { t } = useTranslation(["common", "catalogs"])
  const navigation = usePlatformNavigation()
  return (
    <SidebarProvider
      labels={{
        toggle: t("toggleSidebar"),
        mobileTitle: t("sidebar"),
        mobileDescription: t("sidebarDescription"),
      }}
    >
      <Sidebar>
        <SidebarContent>
          <NavMain label={t("navigation")} items={navigation.items} />
        </SidebarContent>
      </Sidebar>
      <main className="w-full p-6">
        <h1 className="text-xl font-semibold">{t("catalogs:iframe")}</h1>
        <Outlet />
      </main>
    </SidebarProvider>
  )
}
function HiddenFrameStory() {
  const [router] = useState(() => {
    const root = createRootRoute()
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      component: NavigationShell,
    })
    const embedded = createRoute({
      getParentRoute: () => platform,
      path: "embedded/$menuId",
      component: PlatformEmbeddedPage,
    })
    return createRouter({
      routeTree: root.addChildren([platform.addChildren([embedded])]),
      history: createMemoryHistory({
        initialEntries: [`/platform/embedded/${hiddenPlatformFrameId}`],
      }),
    })
  })
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}
const meta = {
  title: "Platform/System/Navigation access",
  component: HiddenFrameStory,
  globals: { locale: "en-US" },
  parameters: {
    layout: "fullscreen",
    msw: {
      handlers: [
        createHiddenPlatformFrameHandler(),
        ...createWorkspaceSessionHandlers(),
      ],
    },
  },
} satisfies Meta<typeof HiddenFrameStory>
export default meta
type Story = StoryObj<typeof meta>
export const HiddenFrameRemainsAccessible: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTitle("Private report")).toHaveAttribute(
      "src",
      hiddenPlatformFrameUrl
    )
    await expect(canvas.getByTitle("Private report")).toBeVisible()
    const navigation = within(
      canvas.getByRole("navigation", { name: "Main navigation" })
    )
    await expect(
      navigation.getByRole("link", { name: "Visible portal" })
    ).toBeVisible()
    await expect(
      navigation.queryByRole("link", { name: "Private report" })
    ).toBeNull()
    await expect(
      navigation.queryByRole("button", { name: "Hidden children only" })
    ).toBeNull()
  },
}
