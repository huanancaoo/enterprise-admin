import { useState } from "react"
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createWorkspaceSessionHandlers,
  createProjectsHandler,
  createProjectDetailHandler,
  organizations,
} from "@workspace/mocks"
import { router as applicationRouter } from "../router"

function AdminLayoutStory() {
  const [router] = useState(() =>
    createRouter({
      routeTree: applicationRouter.routeTree,
      history: createMemoryHistory({
        initialEntries: [`/app/projects/${organizations[0].id}`],
      }),
    })
  )
  return <RouterProvider router={router} />
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
    await expect(
      await canvas.findByRole("link", { name: "办公空间 2-26" })
    ).toBeVisible()
    await expect(
      canvasElement.querySelector('[data-slot="sidebar"][data-state]')
    ).toBe(sidebar)
  },
}

export const SuspendedOrganization: Story = {
  parameters: {
    msw: {
      handlers: [
        ...createWorkspaceSessionHandlers({
          suspendedIds: [organizations[0].id],
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
      canvas.getByRole("button", { name: /North workspace/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /South workspace/ })
    )
    await expect(await canvas.findByRole("table")).toBeVisible()
    await expect(canvas.queryByRole("alert")).toBeNull()
  },
}
