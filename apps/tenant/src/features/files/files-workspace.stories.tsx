import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
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
import {
  FolderKanbanIcon,
  FolderIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { FilesWorkspace } from "./files-workspace"

const { organizationId, root, launch, poster, queries, handlers } =
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

function WorkspaceStory() {
  const [router] = useState(() => {
    const route = createRootRoute()
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
      <AppShell
        layout="workspace"
        breadcrumb={null}
        sidebar={{
          teamSwitcher: {
            teams: [{ id: organizationId, name: "示例组织" }],
            value: organizationId,
            label: "组织",
            onSelect: fn(),
          },
          navigation: {
            label: "工作空间",
            items: [
              { title: "项目", icon: <FolderKanbanIcon /> },
              { title: "文件", icon: <FolderIcon />, isActive: true },
              { title: "团队", icon: <UsersIcon /> },
              { title: "设置", icon: <SettingsIcon /> },
            ],
          },
          user: {
            user: { name: "陈小明", email: "chen@example.com" },
            signingOut: false,
            onSignOut: fn(),
            onPersonalSettings: fn(),
          },
        }}
      >
        <RouterProvider router={router} />
      </AppShell>
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
    await openPoster(canvasElement)
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
