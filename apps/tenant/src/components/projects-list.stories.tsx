import { expect, userEvent, waitFor, within } from "storybook/test"
import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router"
import {
  ProjectListQuerySchema,
  type ProjectListQuery,
} from "@workspace/contracts"
import { organizations, projectScenarios } from "@workspace/mocks"
import { useState } from "react"
import { ProjectsList } from "./projects-list"

const projectsPath = "/app/projects/$organizationId"

function ProjectsStoryRoute() {
  const { organizationId } = useParams({ strict: false }) as {
    organizationId: string
  }
  const search = useSearch({ strict: false }) as ProjectListQuery
  const navigate = useNavigate({ from: projectsPath })

  return (
    <ProjectsList
      organizationId={organizationId}
      search={search}
      onSearchChange={(updater) =>
        void navigate({
          search: (current: ProjectListQuery) => updater(current),
        })
      }
    />
  )
}

function createProjectsRouter() {
  const rootRoute = createRootRoute()
  const projectsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: projectsPath,
    validateSearch: ProjectListQuerySchema,
    component: ProjectsStoryRoute,
  })
  const history = createMemoryHistory({
    initialEntries: [
      `/app/projects/${organizations[0].id}?page=1&pageSize=20&sortBy=createdAt&sortOrder=desc`,
    ],
  })
  return createRouter({
    routeTree: rootRoute.addChildren([projectsRoute]),
    history,
  })
}

// Stories drive the production list through an actual Router; no local copy of
// query state is introduced between DataTable callbacks and the request.
function ProjectsListStory() {
  const [router] = useState(createProjectsRouter)
  return <RouterProvider router={router} />
}

const meta = {
  title: "Admin/Projects list",
  component: ProjectsListStory,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: projectScenarios.success },
  },
} satisfies Meta<typeof ProjectsListStory>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

export const Loading: Story = {
  parameters: { msw: { handlers: projectScenarios.loading } },
}

export const Empty: Story = {
  parameters: { msw: { handlers: projectScenarios.empty } },
}

export const Error: Story = {
  parameters: { msw: { handlers: projectScenarios.serverError } },
}

export const PermissionDenied: Story = {
  parameters: { msw: { handlers: projectScenarios.forbidden } },
}

export const LongText: Story = {
  parameters: { msw: { handlers: projectScenarios.longText } },
}

export const RTL: Story = {
  globals: { locale: "ar" },
}

export const SlowNetwork: Story = {
  parameters: { msw: { handlers: projectScenarios.slow } },
}

export const SearchAndFilter: Story = {
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "false")
    )
    const input = canvas.getByRole("textbox")
    await userEvent.type(input, "Office space 1-26")
    await expect(input).toHaveValue("Office space 1-26")
    await expect(canvas.getByText("26 rows")).toBeVisible()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(canvas.getByText("1 rows")).toBeVisible())
    await expect(
      canvas.getByRole("link", { name: "Office space 1-26" })
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Status" }))
    await userEvent.click(await screen.findByRole("option", { name: "Draft" }))
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(canvas.getByText("No results")).toBeVisible())
    await userEvent.click(
      within(canvas.getByRole("table")).getByRole("button", {
        name: "Clear filters",
      })
    )
    await waitFor(() => expect(canvas.getByText("26 rows")).toBeVisible())
    await expect(canvas.getByRole("textbox")).toHaveValue("")
    await expect(canvas.getByRole("button", { name: "Status" })).toBeVisible()
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}
