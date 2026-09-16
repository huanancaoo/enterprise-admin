import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createProjectDetailHandler,
  createProjectEditHandlers,
  organizations,
  projectFixtures,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import { ProjectDetail } from "./project-detail"
import { ProjectEditForm } from "./project-edit"

const detailPath = "/app/projects/$organizationId/$projectId"
const project = projectFixtures(organizations[0].id, "zh-CN")[0]!

function ProjectDetailStoryRoute() {
  const { organizationId, projectId } = useParams({ strict: false }) as {
    organizationId: string
    projectId: string
  }
  return <ProjectDetail organizationId={organizationId} projectId={projectId} />
}

function createDetailRouter() {
  const rootRoute = createRootRoute()
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: detailPath,
    component: ProjectDetailStoryRoute,
  })
  return createRouter({
    routeTree: rootRoute.addChildren([detailRoute]),
    history: createMemoryHistory({
      initialEntries: [`/app/projects/${organizations[0].id}/${project.id}`],
    }),
  })
}

function ProjectDetailStory() {
  const [router] = useState(createDetailRouter)
  return <RouterProvider router={router} />
}

function ProjectEditStory({ refresh = false }: { refresh?: boolean }) {
  const { t } = useTranslation("projects")
  const [targetLocale, setTargetLocale] = useState<"zh-CN" | "en-US" | "ar">(
    "zh-CN"
  )
  const [initial, setInitial] = useState({
    name: "原始内容",
    description: "原始描述",
  })
  return (
    <>
      {refresh && (
        <Button
          onClick={() =>
            setInitial({ name: "服务端刷新内容", description: "刷新后描述" })
          }
        >
          {t("refreshServerContent")}
        </Button>
      )}
      <ProjectEditForm
        organizationId={organizations[0].id}
        project={project}
        targetLocale={targetLocale}
        onTargetLocaleChange={setTargetLocale}
        initial={initial}
        onOpenChange={() => undefined}
      />
    </>
  )
}

const meta = {
  title: "Admin/Project detail",
  component: ProjectDetailStory,
  parameters: {
    layout: "fullscreen",
    msw: {
      handlers: [...createProjectEditHandlers(), createProjectDetailHandler()],
    },
  },
} satisfies Meta<typeof ProjectDetailStory>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole("heading", { name: project.name })
    ).toBeVisible()
    await expect(canvas.getByText("用于验证项目详情的描述。")).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: { msw: { handlers: [createProjectDetailHandler("loading")] } },
}

export const Error: Story = {
  parameters: {
    msw: { handlers: [createProjectDetailHandler("serverError")] },
  },
}

export const PermissionDenied: Story = {
  parameters: {
    msw: { handlers: [createProjectDetailHandler("forbidden")] },
  },
}

export const NotFound: Story = {
  parameters: {
    msw: { handlers: [createProjectDetailHandler("notFound")] },
  },
}

export const LongText: Story = {
  parameters: {
    msw: { handlers: [createProjectDetailHandler("longText")] },
  },
}

export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.closest("[dir]"))?.toHaveAttribute("dir", "rtl")
  },
}

export const EditRefreshKeepsDraft: Story = {
  render: () => <ProjectEditStory refresh />,
  parameters: {
    msw: {
      handlers: [
        ...createProjectEditHandlers("refreshDraft"),
        createProjectDetailHandler(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    const name = await dialog.findByLabelText("项目名称")
    await userEvent.clear(name)
    await userEvent.type(name, "本地草稿")
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "刷新服务器内容",
        hidden: true,
      })
    )
    await waitFor(() => expect(name).toHaveValue("本地草稿"))
  },
}

export const EditFailureKeepsDraft: Story = {
  render: () => <ProjectEditStory />,
  parameters: {
    msw: {
      handlers: [
        ...createProjectEditHandlers("error"),
        createProjectDetailHandler(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    const name = await dialog.findByLabelText("项目名称")
    await userEvent.clear(name)
    await userEvent.type(name, "保留草稿")
    await userEvent.click(dialog.getByRole("button", { name: "保存项目" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "操作未成功"
    )
    await expect(name).toHaveValue("保留草稿")
  },
}

export const EditRTL: Story = {
  render: () => <ProjectEditStory />,
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await screen.findByRole("dialog")
    await expect(canvasElement.closest("[dir]"))?.toHaveAttribute("dir", "rtl")
    const dialog = await screen.findByRole("dialog")
    await expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    await expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(
      window.innerWidth
    )
  },
}
