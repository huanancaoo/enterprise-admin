import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { organizationKeys } from "@workspace/api-client"
import {
  createProjectAccessScenario,
  organizations,
  personalAvatarUser,
  projectFixtures,
} from "@workspace/mocks"
import { Button } from "@workspace/ui/components/button"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { authClient } from "@/lib/auth-client"
import { ProjectCreate } from "./project-create"
import { ProjectDetail } from "./project-detail"

const organizationId = organizations[0]!.id
const project = projectFixtures(organizationId, "zh-CN")[0]!
function createDetailRouter() {
  const root = createRootRoute()
  const detail = createRoute({
    getParentRoute: () => root,
    path: "/app/projects/$organizationId/$projectId",
    component: () => (
      <ProjectDetail organizationId={organizationId} projectId={project.id} />
    ),
  })
  return createRouter({
    routeTree: root.addChildren([detail]),
    history: createMemoryHistory({
      initialEntries: [`/app/projects/${organizationId}/${project.id}`],
    }),
  })
}
function ProjectAccessStory({
  scenario,
}: {
  scenario: ReturnType<typeof createProjectAccessScenario>
}) {
  const [router] = useState(createDetailRouter)
  const [mount, setMount] = useState(0)
  const client = useQueryClient()
  // i18next-instrument-ignore
  return (
    <AuthenticatedSessionProvider client={authClient} user={personalAvatarUser}>
      <Button onClick={() => setMount((previous) => previous + 1)}>
        Remount project
      </Button>
      <Button
        onClick={() => {
          scenario.advance()
          void client.invalidateQueries({
            queryKey: organizationKeys.access(organizationId),
          })
        }}
      >
        Refresh authorization
      </Button>
      <div key={mount}>
        <ProjectCreate organizationId={organizationId} />
        <RouterProvider router={router} />
      </div>
    </AuthenticatedSessionProvider>
  )
}
const shared = createProjectAccessScenario("shared")
const denied = createProjectAccessScenario("denied")
const failed = createProjectAccessScenario("error")
const meta = {
  title: "Tenant/Projects access",
  component: ProjectAccessStory,
  args: { scenario: shared },
  parameters: { msw: { handlers: shared.handlers } },
  beforeEach: shared.reset,
} satisfies Meta<typeof ProjectAccessStory>
export default meta
type Story = StoryObj<typeof meta>
async function expectChecks(
  scenario: ReturnType<typeof createProjectAccessScenario>,
  versions: number[]
) {
  await waitFor(() => {
    expect(scenario.checks).toHaveLength(versions.length * 2)
    for (const authorizationVersion of versions)
      for (const action of ["update", "translate"])
        expect(scenario.checks).toContainEqual({
          organizationId,
          authorizationVersion,
          action,
        })
  })
}
export const ProjectionReusedAndAuthorizationVersionRefreshed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const edit = () => canvas.getByRole("button", { name: "编辑项目" })
    await waitFor(() => expect(edit()).toBeEnabled())
    await canvas.findByRole("button", { name: "保存正文" })
    await expectChecks(shared, [1])
    await userEvent.click(
      canvas.getByRole("button", { name: "Remount project" })
    )
    await waitFor(() => expect(edit()).toBeEnabled())
    await canvas.findByRole("button", { name: "保存正文" })
    await expectChecks(shared, [1])
    await userEvent.click(
      canvas.getByRole("button", { name: "Refresh authorization" })
    )
    await expectChecks(shared, [1, 2])
    await waitFor(() => expect(edit()).toBeEnabled())
    await waitFor(() =>
      expect(
        canvasElement.querySelector('.tiptap[contenteditable="true"]')
      ).not.toBeNull()
    )
    await userEvent.click(edit())
    const screen = within(canvasElement.ownerDocument.body)
    await waitFor(() =>
      expect(screen.getByText("翻译项目时附件只读。")).toBeVisible()
    )
    const dialog = within(screen.getByRole("dialog"))
    await expect(dialog.getByLabelText("状态")).toBeDisabled()
    await expect(dialog.queryByRole("button", { name: "添加附件" })).toBeNull()
    await expect(dialog.queryByRole("button", { name: "移除引用" })).toBeNull()
    await expect(dialog.getByText("Attachment.txt")).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await expectChecks(shared, [1, 2])
  },
}
export const PendingThenDeniedNeverGrantsEditing: Story = {
  args: { scenario: denied },
  parameters: { msw: { handlers: denied.handlers } },
  beforeEach: denied.reset,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectChecks(denied, [1])
    await expect(
      canvas.getByRole("button", { name: "编辑项目" })
    ).toBeDisabled()
    await expect(canvas.queryByRole("button", { name: "保存正文" })).toBeNull()
    await expect(
      canvasElement.querySelector('.tiptap[contenteditable="true"]')
    ).toBeNull()
    denied.release()
    await canvas.findByText("该语言暂无富文本正文。")
    await expect(
      canvas.getByRole("button", { name: "编辑项目" })
    ).toBeDisabled()
    await expect(canvas.queryByRole("button", { name: "保存正文" })).toBeNull()
    await expectChecks(denied, [1])
  },
}
export const FailedProjectionNeverGrantsEditing: Story = {
  args: { scenario: failed },
  parameters: { msw: { handlers: failed.handlers } },
  beforeEach: failed.reset,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(canvas.getByRole("alert")).toBeVisible())
    await canvas.findByText("该语言暂无富文本正文。")
    await expect(
      canvas.getByRole("button", { name: "编辑项目" })
    ).toBeDisabled()
    await expect(canvas.queryByRole("button", { name: "保存正文" })).toBeNull()
    await expect(
      canvasElement.querySelector('.tiptap[contenteditable="true"]')
    ).toBeNull()
    await expectChecks(failed, [1])
  },
}
