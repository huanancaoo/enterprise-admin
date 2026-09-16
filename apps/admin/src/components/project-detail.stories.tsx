import { useState } from "react"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within } from "storybook/test"
import {
  createProjectDetailHandler,
  organizations,
  projectFixtures,
} from "@workspace/mocks"
import { ProjectDetail } from "./project-detail"

const detailPath = "/app/projects/$organizationId/$projectId"
const project = projectFixtures(organizations[0].id, "zh-CN")[0]!

function ProjectDetailStoryRoute() {
  const { organizationId, projectId } = useParams({ strict: false }) as {
    organizationId: string
    projectId: string
  }
  return (
    <ProjectDetail
      organizationId={organizationId}
      projectId={projectId}
      organizations={organizations}
      organizationPending={false}
      onOrganizationSelect={async () => true}
      onOrganizationChange={() => undefined}
    />
  )
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

const meta = {
  title: "Admin/Project detail",
  component: ProjectDetailStory,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: [createProjectDetailHandler()] },
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
