import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { PermissionDeniedState } from "@workspace/admin"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  createPlatformSettingsHandlers,
  createWorkspaceSessionHandlers,
  type PlatformSettingsScenario,
} from "@workspace/mocks"
import { authClient } from "../lib/auth-client"
import { PlatformSettingsPage } from "./settings-page"

const user = {
  id: "d6da9c25-56a2-46f1-b5d8-2f17ff3e3204",
  name: "Platform operator",
  email: "operator@example.test",
}

function SettingsStory({ auditor = false }: { auditor?: boolean }) {
  const [router] = useState(() => {
    const root = createRootRoute()
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      beforeLoad: () => ({
        platformAccess: {
          userId: user.id,
          role: auditor ? "platform_auditor" : "platform_admin",
          scope: "global",
          mfaVerifiedAt: "2026-10-02T00:00:00.000Z",
        },
      }),
      component: Outlet,
    })
    const settings = createRoute({
      getParentRoute: () => platform,
      path: "settings",
      component: PlatformSettingsPage,
    })
    const denied = createRoute({
      getParentRoute: () => platform,
      path: "access-denied",
      component: PermissionDeniedState,
    })
    const login = createRoute({
      getParentRoute: () => root,
      path: "login",
      component: PermissionDeniedState,
    })
    return createRouter({
      routeTree: root.addChildren([
        platform.addChildren([settings, denied]),
        login,
      ]),
      history: createMemoryHistory({ initialEntries: ["/platform/settings"] }),
    })
  })
  // 场景使用正式页面和 Router，权限错误走页面原有跳转，提交走生成客户端。
  return (
    <AuthenticatedSessionProvider client={authClient} user={user}>
      <main className="mx-auto max-w-5xl p-6">
        <RouterProvider router={router} />
      </main>
    </AuthenticatedSessionProvider>
  )
}

const handlers = (scenario: PlatformSettingsScenario = "success") => [
  ...createWorkspaceSessionHandlers(),
  ...createPlatformSettingsHandlers(scenario),
]
const meta = {
  title: "Platform/Settings",
  component: SettingsStory,
  parameters: { layout: "fullscreen", msw: { handlers: handlers() } },
} satisfies Meta<typeof SettingsStory>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = {
  parameters: { msw: { handlers: handlers("loading") } },
}
// 设置是必有的单例；这里展示尚未配置 SMTP，而不是伪造不存在的设置记录。
export const Empty: Story = {
  parameters: { msw: { handlers: handlers("emptyConfiguration") } },
}
export const Error: Story = {
  parameters: { msw: { handlers: handlers("unavailable") } },
}
export const PermissionDenied: Story = {
  parameters: { msw: { handlers: handlers("forbidden") } },
}
export const SessionExpired: Story = {
  parameters: { msw: { handlers: handlers("unauthorized") } },
}
export const ReadOnly: Story = { args: { auditor: true } }
export const LongText: Story = {
  parameters: { msw: { handlers: handlers("longText") } },
}
export const RTL: Story = { globals: { locale: "ar" } }
export const SlowNetwork: Story = {
  parameters: { msw: { handlers: handlers("slow") } },
}
export const SaveWithKeyboard: Story = {
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reason = await canvas.findByRole("textbox", {
      name: "Reason for change",
    })
    await userEvent.type(reason, "Review default language setting")
    const submit = canvas.getByRole("button", { name: "Save" })
    submit.focus()
    await userEvent.keyboard("{Enter}")
    await expect(submit).toBeDisabled()
    await expect(reason).toHaveValue("Review default language setting")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Platform default language saved."
      )
    )
    await expect(reason).toHaveValue("")
  },
}
export const StaleVersion: Story = {
  globals: { locale: "en-US" },
  parameters: { msw: { handlers: handlers("stale") } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reason = await canvas.findByRole("textbox", {
      name: "Reason for change",
    })
    await userEvent.type(reason, "Preserve this operator draft")
    await userEvent.click(canvas.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible())
    await expect(reason).toHaveValue("Preserve this operator draft")
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Discard draft and reload latest settings",
      })
    )
    await waitFor(() => expect(reason).not.toBeInTheDocument())
    await expect(
      canvas.getByRole("textbox", { name: "Reason for change" })
    ).toHaveValue("")
    await expect(canvas.getByRole("combobox")).toHaveTextContent("العربية")
  },
}
export const RateLimited: Story = {
  globals: { locale: "en-US" },
  parameters: { msw: { handlers: handlers("rateLimited") } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const reason = await canvas.findByRole("textbox", {
      name: "Reason for change",
    })
    await userEvent.type(reason, "Keep input after failed request")
    await userEvent.click(canvas.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible())
    await expect(reason).toHaveValue("Keep input after failed request")
  },
}
