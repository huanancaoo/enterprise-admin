import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { useUiLocale } from "@workspace/i18n/react"
import { AuthGate, type WorkspaceRouterContext } from "@workspace/admin/auth"
import {
  createWorkspaceSessionHandlers,
  createEmptyTenantAnnouncementInboxHandler,
  createProjectsHandler,
  createMembersScenario,
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

const emptyAnnouncements = createEmptyTenantAnnouncementInboxHandler()

const meta = {
  title: "Admin/Application layout",
  component: AdminLayoutStory,
  parameters: {
    layout: "fullscreen",
    msw: {
      handlers: [
        emptyAnnouncements,
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
    // 首屏还需加载认证会话与懒加载路由，这里验证持久化而非首屏性能。
    const project = await canvas.findByRole(
      "link",
      { name: "办公空间 1-26" },
      { timeout: 5000 }
    )
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
      await canvas.findByRole(
        "heading",
        { name: "办公空间 1-26" },
        { timeout: 5000 }
      )
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
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0)
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
      '[data-slot="page-scroll"]'
    )!
    content.scrollTop = content.scrollHeight
    await waitFor(() => expect(content.scrollTop).toBeGreaterThan(0))

    // 从固定头像入口换页，避免点击内容区元素自动滚动而掩盖旧位置残留。
    await userEvent.click(
      within(
        canvasElement.querySelector(
          '[data-slot="sidebar-footer"]'
        )! as HTMLElement
      ).getByRole("button")
    )
    await userEvent.click(
      await within(canvasElement.ownerDocument.body).findByRole("menuitem", {
        name: "个人设置",
      })
    )
    await expect(
      await canvas.findByRole("heading", { name: "个人设置", level: 1 })
    ).toBeVisible()
    await waitFor(() => expect(content.scrollTop).toBe(0))
    await waitFor(() =>
      expect(
        within(canvasElement.ownerDocument.body).queryAllByRole("menu", {
          hidden: true,
        })
      ).toHaveLength(0)
    )
  },
}

export const SuspendedOrganization: Story = {
  parameters: {
    msw: {
      handlers: [
        emptyAnnouncements,
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
      expect(screen.queryAllByRole("menuitem")).toHaveLength(0)
    )
    await expect(await canvas.findByRole("table")).toBeVisible()
    await expect(canvas.queryByRole("alert")).toBeNull()
  },
}

export const WorkspaceRefreshPending: Story = {
  parameters: {
    msw: {
      handlers: [
        emptyAnnouncements,
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
    await expect(
      canvas.getByRole("link", { name: "办公空间 1-26" })
    ).toBeVisible()
    await expect(
      canvas.queryByRole("link", { name: "办公空间 2-26" })
    ).toBeNull()
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { hidden: true })
      ).not.toBeInTheDocument()
    )
  },
}

export const OrganizationNavigationWithoutSettingsPermission: Story = {
  parameters: {
    msw: {
      handlers: [
        emptyAnnouncements,
        ...createMembersScenario("member").handlers,
        ...createWorkspaceSessionHandlers(),
        createProjectsHandler(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // 此成员有目录读取权，没有组织设置读取权；管理区不能被后者一并拦住。
    const business = within(
      await canvas.findByRole("navigation", { name: "Business work" })
    )
    const management = within(
      canvas.getByRole("navigation", { name: "Organization management" })
    )
    const integrations = within(
      canvas.getByRole("navigation", { name: "Developer integrations" })
    )
    await expect(business.getAllByRole("link")).toHaveLength(3)
    await expect(management.getAllByRole("link")).toHaveLength(3)
    await expect(integrations.getAllByRole("link")).toHaveLength(1)
    for (const section of [business, management, integrations]) {
      await expect(section.queryByRole("button")).toBeNull()
      for (const link of section.getAllByRole("link")) {
        await expect(link.querySelector("svg")).toBeVisible()
      }
    }
    await expect(
      business.getByRole("link", { name: "Task center" })
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/app/tasks/${organizations[0].id}`)
    )
    await expect(
      canvas.getAllByRole("link", { name: "Task center" })
    ).toHaveLength(1)
    await expect(
      canvas.getByRole("link", { name: "Notifications" })
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/app/notifications/${organizations[0].id}`)
    )
    await expect(
      management.getByRole("link", { name: "Operation logs" })
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/app/organizations/${organizations[0].id}/audit`)
    )
    await expect(
      canvas.getByRole("button", { name: "Open announcement inbox" })
    ).toBeVisible()
    await userEvent.click(
      management.getByRole("link", { name: "Members & invitations" })
    )
    await expect(
      canvas.getAllByRole("navigation", { name: "Organization management" })
    ).toHaveLength(1)
    await expect(
      management.getByRole("link", { name: "Members & invitations" })
    ).toHaveAttribute("aria-current", "page")
    await expect(
      management.queryByRole("link", { name: "General settings" })
    ).toBeNull()
    await expect(
      await canvas.findByRole("columnheader", { name: "Member account" })
    ).toBeVisible()
    await expect(
      management.getByRole("link", { name: "Roles & permissions" })
    ).toHaveAttribute("href", `/app/organizations/${organizations[0].id}/roles`)
  },
}

const rejectedSwitch = fn()
export const OrganizationSwitchRejected: Story = {
  beforeEach: () => {
    rejectedSwitch.mockClear()
  },
  parameters: {
    msw: {
      handlers: [
        emptyAnnouncements,
        ...createWorkspaceSessionHandlers({
          selectError: "Switch denied",
          onSelect: rejectedSwitch,
        }),
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
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Switch denied"
    )
    await expect(rejectedSwitch).toHaveBeenCalledTimes(1)
    await expect(
      canvas.getByRole("link", { name: "办公空间 1-26" })
    ).toBeVisible()
    await expect(
      canvas.queryByRole("link", { name: "办公空间 2-26" })
    ).toBeNull()
    await expect(
      canvas.getByRole("button", { name: /North workspace/ })
    ).not.toBeDisabled()
    await waitFor(() =>
      expect(screen.queryAllByRole("menu", { hidden: true })).toHaveLength(0)
    )
  },
}

const suspendedSwitch = fn()
export const SelectSuspendedOrganization: Story = {
  beforeEach: () => {
    suspendedSwitch.mockClear()
  },
  parameters: {
    msw: {
      handlers: [
        emptyAnnouncements,
        ...createWorkspaceSessionHandlers({
          suspendedIds: [organizations[1].id],
          onSelect: suspendedSwitch,
        }),
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
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "该组织已停用"
    )
    await expect(suspendedSwitch).not.toHaveBeenCalled()
    await expect(
      canvas.getByRole("button", { name: /South workspace/ })
    ).toBeVisible()
    await expect(canvas.queryByRole("table")).toBeNull()
    await waitFor(() =>
      expect(screen.queryAllByRole("menu", { hidden: true })).toHaveLength(0)
    )
  },
}

export const OrganizationSwitchPreservesSelectedLocale: Story = {
  parameters: {
    msw: {
      handlers: [
        emptyAnnouncements,
        ...createWorkspaceSessionHandlers({
          organizationLocales: { [organizations[1].id]: "en-US" },
        }),
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
    await expect(
      await canvas.findByRole("link", { name: "办公空间 2-26" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("navigation", { name: "业务工作" })
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.queryAllByRole("menu", { hidden: true })).toHaveLength(0)
    )
  },
}
