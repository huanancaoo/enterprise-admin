import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { AuthGate, type WorkspaceRouterContext } from "@workspace/admin/auth"
import { useUiLocale } from "@workspace/i18n/react"
import {
  createPlatformOrganizationScenario,
  createWorkspaceSessionHandlers,
} from "@workspace/mocks"
import { router as applicationRouter } from "./router"
import { authClient } from "./lib/auth-client"

function PlatformLayoutRouter(context: WorkspaceRouterContext) {
  const [router] = useState(() =>
    createRouter({
      routeTree: applicationRouter.routeTree,
      history: createMemoryHistory({ initialEntries: ["/platform"] }),
      context,
    })
  )
  return <RouterProvider router={router} context={context} />
}

function PlatformLayoutStory() {
  const { t } = useTranslation("auth")
  const locale = useUiLocale()
  return (
    <AuthGate client={authClient} restoreTitle={t("platformTitle")}>
      {({ user, queryClient }) => (
        <PlatformLayoutRouter
          user={user}
          queryClient={queryClient}
          locale={locale}
        />
      )}
    </AuthGate>
  )
}

const meta = {
  title: "Platform/Application layout",
  component: PlatformLayoutStory,
  parameters: {
    layout: "fullscreen",
    msw: {
      handlers: [
        ...createWorkspaceSessionHandlers(),
        ...createPlatformOrganizationScenario().handlers,
      ],
    },
  },
} satisfies Meta<typeof PlatformLayoutStory>
export default meta
type Story = StoryObj<typeof meta>

export const DefaultOrganizationLanding: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole(
        "heading",
        { name: "组织", level: 1 },
        { timeout: 5000 }
      )
    ).toBeVisible()
    const navigation = within(
      canvas.getByRole("navigation", { name: "主导航" })
    )
    await expect(
      navigation.getAllByRole("link").map((link) => link.textContent)
    ).toEqual(["组织管理", "全局账号"])
    await expect(
      navigation.getByRole("link", { name: "组织管理" })
    ).toHaveAttribute("aria-current", "page")
    await userEvent.click(
      within(
        canvasElement.querySelector(
          '[data-slot="sidebar-footer"]'
        )! as HTMLElement
      ).getByRole("button")
    )
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "个人设置" })
    )
    await expect(
      await canvas.findByRole(
        "heading",
        { name: "个人设置", level: 1 },
        { timeout: 5000 }
      )
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.queryAllByRole("menu", { hidden: true })).toHaveLength(0)
    )
  },
}
