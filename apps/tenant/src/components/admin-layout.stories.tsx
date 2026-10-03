import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { useUiLocale } from "@workspace/i18n/react"
import { AuthGate, type WorkspaceRouterContext } from "@workspace/admin/auth"
import {
  createWorkspaceSessionHandlers,
  createProjectsHandler,
  createProjectDetailHandler,
  createProjectAttachmentsScenario,
  organizations,
} from "@workspace/mocks"
import { router as applicationRouter } from "../router"
import { authClient } from "../lib/auth-client"

function AdminLayoutRouter({
  user,
  queryClient,
  locale,
}: WorkspaceRouterContext) {
  const [router] = useState(() =>
    createRouter({
      routeTree: applicationRouter.routeTree,
      scrollToTopSelectors: applicationRouter.options.scrollToTopSelectors,
      history: createMemoryHistory({
        initialEntries: [`/app/projects/${organizations[0].id}`],
      }),
      context: {
        user,
        queryClient,
        locale,
      },
    })
  )
  return (
    <RouterProvider router={router} context={{ user, queryClient, locale }} />
  )
}

function AdminLayoutStory() {
  const locale = useUiLocale()
  const { t } = useTranslation("organization")
  // 布局依赖原生会话投影；仅注入路由 user 会在会话读回前提前挂载工作台。
  return (
    <AuthGate client={authClient} restoreTitle={t("management")}>
      {({ user, queryClient }) => (
        <AdminLayoutRouter
          user={user}
          queryClient={queryClient}
          locale={locale}
        />
      )}
    </AuthGate>
  )
}

const meta = {
  title: "Admin/Application layout",
  component: AdminLayoutStory,
  parameters: {
    layout: "fullscreen",
    msw: {
      handlers: [
        ...createWorkspaceSessionHandlers(),
        createProjectsHandler(),
        createProjectDetailHandler(),
        ...createProjectAttachmentsScenario().handlers,
      ],
    },
  },
} satisfies Meta<typeof AdminLayoutStory>
export default meta
type Story = StoryObj<typeof meta>

export const PersistentSidebar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const project = await canvas.findByRole("link", { name: "办公空间 1-26" })
    const sidebar = canvasElement.querySelector(
      '[data-slot="sidebar"][data-state]'
    )
    await expect(sidebar).toHaveAttribute("data-state", "expanded")
    await userEvent.click(
      canvasElement.querySelector('[data-slot="sidebar-trigger"]')!
    )
    await waitFor(() =>
      expect(sidebar).toHaveAttribute("data-state", "collapsed")
    )
    await userEvent.click(project)
    await expect(
      await canvas.findByRole("heading", { name: "办公空间 1-26" })
    ).toBeVisible()
    await expect(canvas.getByText("项目详情")).toBeVisible()
    await expect(
      canvasElement.querySelector('[data-slot="sidebar"][data-state]')
    ).toBe(sidebar)
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await userEvent.click(canvas.getByRole("link", { name: "返回项目列表" }))
    await expect(await canvas.findByRole("table")).toBeVisible()
    await expect(sidebar).toHaveAttribute("data-state", "collapsed")
    await userEvent.click(
      canvasElement.querySelector('[data-slot="sidebar-trigger"]')!
    )
    await userEvent.click(
      canvas.getByRole("button", { name: /North workspace/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /South workspace/ })
    )
    await waitFor(() =>
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    )
    await expect(
      await canvas.findByRole("link", { name: "办公空间 2-26" })
    ).toBeVisible()
    await expect(
      canvasElement.querySelector('[data-slot="sidebar"][data-state]')
    ).toBe(sidebar)
  },
}

export const RouteScrollReset: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("link", { name: "办公空间 1-26" })
    const content = canvasElement.querySelector<HTMLElement>(
      '[data-slot="sidebar-inset"]'
    )!
    content.scrollTop = content.scrollHeight
    await waitFor(() => expect(content.scrollTop).toBeGreaterThan(0))

    // 从固定侧栏换页，避免点击内容区元素自动滚动而掩盖旧位置残留。
    await userEvent.click(canvas.getByRole("link", { name: "个人设置" }))
    await expect(
      await canvas.findByRole("heading", { name: "个人设置", level: 1 })
    ).toBeVisible()
    await waitFor(() => expect(content.scrollTop).toBe(0))
  },
}

export const SuspendedOrganization: Story = {
  parameters: {
    msw: {
      handlers: [
        ...createWorkspaceSessionHandlers({
          suspendedIds: [organizations[0].id],
          // 访问拒绝先到达时，切换器仍需等待独立的组织目录。
          listDelay: 300,
        }),
        createProjectsHandler(),
        createProjectDetailHandler(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "该组织已停用"
    )
    await expect(canvas.queryByRole("table")).toBeNull()
    await userEvent.click(
      await canvas.findByRole("button", { name: /North workspace/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /South workspace/ })
    )
    await waitFor(() =>
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    )
    await expect(await canvas.findByRole("table")).toBeVisible()
    await expect(canvas.queryByRole("alert")).toBeNull()
  },
}

export const WorkspaceRefreshPending: Story = {
  parameters: {
    msw: {
      handlers: [
        ...createWorkspaceSessionHandlers({ refreshDelay: "infinite" }),
        createProjectsHandler(),
        createProjectDetailHandler(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findByRole("link", { name: "办公空间 1-26" })
    await userEvent.click(
      canvas.getByRole("button", { name: /North workspace/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /South workspace/ })
    )
    const switcher = canvas.getByRole("button", { name: /workspace/ })
    await waitFor(() => expect(switcher).toHaveAttribute("data-disabled", ""))
    await expect(switcher).toBeDisabled()
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { hidden: true })
      ).not.toBeInTheDocument()
    )
  },
}
