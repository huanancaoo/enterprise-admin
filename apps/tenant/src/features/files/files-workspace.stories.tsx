import { WorkspaceActions } from "@/components/workspace-actions"
import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  useNavigate,
  useSearch,
} from "@tanstack/react-router"
import {
  FileListQuerySchema,
  type FileListQuery,
} from "@workspace/contracts/files"
import { AppShell } from "@workspace/admin"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { fileWorkspaceScenario, personalAvatarUser } from "@workspace/mocks"
import { FolderKanbanIcon, FolderIcon, BuildingIcon } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { FilesWorkspace } from "./files-workspace"

const { organizationId, root, launch, brand, poster, queries, handlers } =
  fileWorkspaceScenario

function WorkspaceRoute() {
  const search = useSearch({ strict: false }) as FileListQuery
  const navigate = useNavigate({ from: "/app/files/$organizationId" })
  return (
    <FilesWorkspace
      organizationId={organizationId}
      search={search}
      onSearchChange={(updater) =>
        void navigate({ search: (current: FileListQuery) => updater(current) })
      }
      onOpenFile={fn()}
      onOpenVersion={fn()}
    />
  )
}

function WorkspaceShell() {
  return (
    <AppShell
      layout="workspace"
      actions={<WorkspaceActions organizationId={organizationId} />}
      breadcrumb={null}
      sidebar={{
        teamSwitcher: {
          teams: [{ id: organizationId, name: "示例组织" }],
          value: organizationId,
          label: "组织",
          onSelect: fn(),
        },
        navigation: [
          {
            label: "工作空间",
            items: [
              { title: "项目", icon: <FolderKanbanIcon /> },
              { title: "文件", icon: <FolderIcon />, isActive: true },
              { title: "组织管理", icon: <BuildingIcon /> },
            ],
          },
        ],
        user: {
          user: { name: "陈小明", email: "chen@example.com" },
          accountMenu: () => null,
          signOutMenu: () => null,
          onPersonalSettings: fn(),
        },
      }}
    >
      <Outlet />
    </AppShell>
  )
}

function WorkspaceStory() {
  const [router] = useState(() => {
    const route = createRootRoute({ component: WorkspaceShell })
    return createRouter({
      routeTree: route.addChildren([
        createRoute({
          getParentRoute: () => route,
          path: "/app/files/$organizationId",
          validateSearch: FileListQuerySchema,
          component: WorkspaceRoute,
        }),
      ]),
      history: createMemoryHistory({
        initialEntries: [
          `/app/files/${organizationId}?parentId=${launch.id}&state=active&page=1&pageSize=20&sortBy=name&sortOrder=asc`,
        ],
      }),
    })
  })
  return (
    <AuthenticatedSessionProvider client={authClient} user={personalAvatarUser}>
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}

const meta = {
  title: "Tenant/Files workspace",
  component: WorkspaceStory,
  parameters: { layout: "fullscreen", msw: { handlers } },
  beforeEach: () => {
    queries.length = 0
  },
} satisfies Meta<typeof WorkspaceStory>
export default meta
type Story = StoryObj<typeof meta>

async function openPoster(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await waitFor(() =>
    expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "false")
  )
  await within(canvas.getByRole("navigation", { name: "目录" })).findByRole(
    "button",
    { name: "项目文档" }
  )
  await userEvent.click(canvas.getByRole("button", { name: poster.name }))
  const preview = within(await canvas.findByRole("region", { name: "预览" }))
  await waitFor(
    () => expect(preview.getByRole("img")).toHaveProperty("naturalWidth", 989),
    { timeout: 10000 }
  )
  return { canvas, preview }
}

export const Preview: Story = {
  play: async ({ canvasElement }) => {
    const { canvas } = await openPoster(canvasElement)
    // 路径操作与批量操作容器必须传递剩余高度，避免长列表撑出视口。
    const workspace = canvasElement.querySelector<HTMLElement>(
      '[data-slot="workspace-page"]'
    )!
    await expect(workspace.getBoundingClientRect().bottom).toBeCloseTo(
      canvas.getByRole("main").getBoundingClientRect().bottom,
      0
    )
    await expect(
      canvasElement.ownerDocument.documentElement.scrollHeight
    ).toBeLessThanOrEqual(window.innerHeight)
    await expect(canvas.getByRole("link", { name: "通知" })).toHaveAttribute(
      "href",
      expect.stringContaining(`/app/notifications/${organizationId}`)
    )
  },
}

export const PreviewSelectionAndNavigation: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, preview } = await openPoster(canvasElement)
    const row = canvas.getByRole("button", { name: poster.name }).closest("tr")!
    const checkbox = within(row).getByRole("checkbox")
    await expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    await expect(checkbox).toBeChecked()
    await expect(preview.getByRole("img")).toBeVisible()
    await userEvent.click(preview.getByRole("button", { name: "关闭" }))
    await expect(checkbox).toBeChecked()
    await expect(
      canvas.getByRole("button", { name: poster.name })
    ).toHaveFocus()
    const tree = within(canvas.getByRole("navigation", { name: "目录" }))
    await tree.findByRole("button", { name: "项目文档" })
    await expect(
      queries.some(
        (query) =>
          query.parentId === root.id &&
          query.page === 2 &&
          query.pageSize === 100
      )
    ).toBe(true)
    await userEvent.click(tree.getByRole("button", { name: "品牌资产" }))
    await canvas.findByText("此文件夹暂无文件或子文件夹。")
    await expect(
      canvas.queryByRole("region", { name: "预览" })
    ).not.toBeInTheDocument()
    await expect(
      canvas.queryAllByRole("checkbox", { checked: true })
    ).toHaveLength(0)
    await expect(
      within(canvas.getByRole("navigation", { name: "目录" })).getByRole(
        "button",
        { name: "品牌资产" }
      )
    ).toHaveAttribute("aria-current", "page")
  },
}

export const FolderNavigationKeepsWorkspace: Story = {
  parameters: {
    msw: {
      handlers: fileWorkspaceScenario.slowNavigationHandlers,
    },
  },
  play: async ({ canvasElement }) => {
    const { canvas } = await openPoster(canvasElement)
    await userEvent.click(
      within(canvas.getByRole("region", { name: "预览" })).getByRole("button", {
        name: "关闭",
      })
    )
    const directory = canvas.getByRole("navigation", { name: "目录" })
    const search = canvas.getByRole("textbox", { name: "搜索文件和文件夹" })
    const view = canvas.getByRole("button", { name: "视图" })
    await userEvent.click(view)
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole("checkbox", {
        name: "显示 类型",
      })
    )
    await userEvent.keyboard("{Escape}")
    const tableTop = canvas.getByRole("table").getBoundingClientRect().top
    const previousFile = canvas.getByRole("button", { name: poster.name })
    const previousActions = canvas.getByRole("button", {
      name: `${poster.name} 的操作`,
    })
    await userEvent.click(
      within(directory).getByRole("button", { name: brand.name })
    )
    // 冷目录的路径请求尚未返回时，导航和搜索不应随内容一起卸载。
    await expect(directory).toBeInTheDocument()
    await expect(search).toBeInTheDocument()
    await expect(view).toBeInTheDocument()
    await expect(previousFile).toBeDisabled()
    await expect(previousActions).toBeDisabled()
    await expect(
      canvas.getByRole("table").getBoundingClientRect().top
    ).toBeCloseTo(tableTop, 0)
    await expect(
      canvas.getByRole("button", { name: "上传文件" })
    ).toBeDisabled()
    await expect(
      within(directory).getByRole("button", { name: "项目文档" })
    ).toBeEnabled()
    await canvas.findByText("此文件夹暂无文件或子文件夹。")
    await expect(canvas.getByRole("navigation", { name: "目录" })).toBe(
      directory
    )
    await expect(canvas.getByRole("button", { name: "视图" })).toBe(view)
    await userEvent.click(
      within(directory).getByRole("button", { name: launch.name })
    )
    await canvas.findByRole("button", { name: poster.name })
    await expect(
      canvas.queryByRole("columnheader", { name: "类型" })
    ).not.toBeInTheDocument()
  },
}

export const FolderNavigationKeepsHeader: Story = {
  parameters: {
    msw: { handlers: fileWorkspaceScenario.slowNavigationHandlers },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "false")
    )
    const directory = canvas.getByRole("navigation", { name: "目录" })
    const path = canvas.getByRole("navigation", { name: "文件夹导航" })
    const create = canvas.getByRole("button", { name: "创建文件夹" })
    const upload = canvas.getByRole("button", { name: "上传文件" })
    await waitFor(() => {
      expect(getComputedStyle(create).opacity).toBe("1")
      expect(getComputedStyle(upload).opacity).toBe("1")
    })
    const before = {
      pathConnected: path.isConnected,
      createOpacity: getComputedStyle(create).opacity,
      uploadOpacity: getComputedStyle(upload).opacity,
    }
    await userEvent.click(
      await within(directory).findByRole("button", { name: brand.name })
    )
    await expect({
      pathConnected: path.isConnected,
      createOpacity: getComputedStyle(create).opacity,
      uploadOpacity: getComputedStyle(upload).opacity,
    }).toEqual(before)
    await expect(create).toBeDisabled()
    await expect(upload).toBeDisabled()
    await expect(canvas.queryByRole("dialog")).not.toBeInTheDocument()
    await canvas.findByText("此文件夹暂无文件或子文件夹。")
    await expect(canvas.getByRole("navigation", { name: "文件夹导航" })).toBe(
      path
    )
    await expect(
      within(path).getByRole("button", { name: brand.name })
    ).toBeVisible()
    await expect(create).toBeEnabled()
    await expect(upload).toBeEnabled()
  },
}

export const PreviewSwitchKeepsListAndPanel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "false")
    )
    const file = canvas.getByRole("button", { name: poster.name })
    const next = canvas.getByRole("button", { name: "社交媒体文案.docx" })
    const checkbox = within(file.closest("tr")!).getByRole("checkbox")
    await userEvent.click(file)
    const panel = await canvas.findByRole("region", { name: "预览" })
    await within(panel).findByRole("img")
    await expect(file).toBeInTheDocument()
    await expect(file).toHaveFocus()
    await expect(checkbox).toBeInTheDocument()
    const close = within(panel).getByRole("button", { name: "关闭" })
    await userEvent.click(checkbox)
    await userEvent.click(next)
    await within(panel).findByRole("heading", { name: "社交媒体文案.docx" })
    await expect(canvas.getByRole("region", { name: "预览" })).toBe(panel)
    await expect(close).toBeInTheDocument()
    await expect(next).toBeInTheDocument()
    await expect(next).toHaveFocus()
    await expect(checkbox).toBeChecked()
    await userEvent.click(close)
    await expect(next).toHaveFocus()
  },
}

export const ScrollingKeepsWorkspaceControls: Story = {
  play: async ({ canvasElement }) => {
    const { canvas } = await openPoster(canvasElement)
    const search = canvas.getByRole("textbox", { name: "搜索文件和文件夹" })
    const pagination = canvas.getByRole("navigation", { name: "分页" })
    const header = canvas.getByRole("columnheader", { name: "名称" })
    const searchTop = search.getBoundingClientRect().top
    const paginationTop = pagination.getBoundingClientRect().top
    const headerTop = header.getBoundingClientRect().top
    const scroller = canvas
      .getByRole("table")
      .closest<HTMLElement>('[data-slot="data-table-content"]')!
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    scroller.scrollTop = scroller.scrollHeight
    await expect(search.getBoundingClientRect().top).toBeCloseTo(searchTop, 0)
    await expect(pagination.getBoundingClientRect().top).toBeCloseTo(
      paginationTop,
      0
    )
    await expect(header.getBoundingClientRect().top).toBeCloseTo(headerTop, 0)
    await expect(pagination.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight
    )
    const trash = canvas.getByRole("button", { name: "回收站" })
    const trashTop = trash.getBoundingClientRect().top
    await userEvent.click(canvas.getByRole("button", { name: "收起 全部文件" }))
    await expect(trash.getBoundingClientRect().top).toBeCloseTo(trashTop, 0)
  },
}

export const RowMenuReturnsFocus: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "false")
    )
    await canvas.findByRole("button", { name: "创建文件夹" })
    const trigger = canvas.getByRole("button", {
      name: `${poster.name} 的操作`,
    })
    await userEvent.click(trigger)
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "重命名" })
    )
    await screen.findByRole("dialog")
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await expect(trigger).toHaveFocus()
  },
}

export const ReadOnly: Story = {
  parameters: {
    msw: {
      handlers: fileWorkspaceScenario.readOnlyHandlers,
    },
  },
  play: async ({ canvasElement }) => {
    const { canvas, preview } = await openPoster(canvasElement)
    await expect(
      canvas.queryByRole("button", { name: "创建文件夹" })
    ).not.toBeInTheDocument()
    await expect(
      preview.queryByRole("button", { name: "重命名" })
    ).not.toBeInTheDocument()
    await expect(
      preview.getByRole("button", { name: "下载文件" })
    ).toBeVisible()
  },
}

export const RTL: Story = { globals: { locale: "ar" } }
