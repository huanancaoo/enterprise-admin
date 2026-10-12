import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within, waitFor } from "storybook/test"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import {
  createTaskCenterScenario,
  taskCenterOrganizationId,
  taskCenterUser,
} from "@workspace/mocks"
import { TaskCenter } from "./task-center"
import type { TaskCenterSearch } from "./task-center-search"
function TaskStory() {
  const [client] = useState(createWorkspaceAuthClient)
  const [search, setSearch] = useState<TaskCenterSearch>({
    page: 1,
    pageSize: 20,
  })
  return (
    <AuthenticatedSessionProvider client={client} user={taskCenterUser}>
      <TaskCenter
        organizationId={taskCenterOrganizationId}
        search={search}
        onSearchChange={setSearch}
      />
    </AuthenticatedSessionProvider>
  )
}
const fixture = createTaskCenterScenario()
const meta = {
  title: "Admin/Task center",
  component: TaskStory,
  globals: { locale: "en-US" },
  parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof TaskStory>
export default meta
type Story = StoryObj<typeof meta>
export const OpensTypedImportReport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("My tasks")).toBeVisible()
    await userEvent.click(
      await canvas.findByRole("button", { name: "View task" })
    )
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog"
    )
    await waitFor(() =>
      expect(within(dialog).getByText("Invalid name")).toBeVisible()
    )
    await expect(within(dialog).getByText("3")).toBeVisible()
    await expect(
      within(dialog).getByText("No projects were added.")
    ).toBeVisible()
  },
}

const organizationFixture = createTaskCenterScenario("organization")
export const ClearsOrganizationCacheAfterRoleChange: Story = {
  beforeEach: organizationFixture.reset,
  parameters: { msw: { handlers: organizationFixture.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText("All organization tasks")
    ).toBeVisible()
    await expect(
      canvas.getByText("a412b4c5-8111-4111-a111-555555555555")
    ).toBeVisible()
    organizationFixture.downgrade()
    await userEvent.click(canvas.getByRole("button", { name: "Refresh tasks" }))
    await expect(await canvas.findByText("My tasks")).toBeVisible()
    await waitFor(() =>
      expect(
        canvas.queryByText("a412b4c5-8111-4111-a111-555555555555")
      ).not.toBeInTheDocument()
    )
  },
}
const batchFixture = createTaskCenterScenario("file-batch")
export const PreservesBatchItemLifecycles: Story = {
  parameters: { msw: { handlers: batchFixture.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText(/Committed; cleaning · 1/)
    ).toBeVisible()
    await expect(
      canvas.getByText(/Covered by selected ancestor · 1/)
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "View task" }))
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog"
    )
    await waitFor(() =>
      expect(within(dialog).getByText("Committed; cleaning")).toBeVisible()
    )
    await expect(within(dialog).getByText(/Handled by item 1/)).toBeVisible()
  },
}

const deniedFixture = createTaskCenterScenario("active-denied")
export const StopsPollingAfterAuthorityRejects: Story = {
  beforeEach: deniedFixture.reset,
  parameters: { msw: { handlers: deniedFixture.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Queued")).toBeVisible()
    deniedFixture.deny()
    await expect(
      await canvas.findByText("Task access denied", {}, { timeout: 2500 })
    ).toBeVisible()
    const reads = deniedFixture.readCount()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(deniedFixture.readCount()).toBe(reads)
    expect(canvas.queryByText("Queued")).not.toBeInTheDocument()
  },
}
