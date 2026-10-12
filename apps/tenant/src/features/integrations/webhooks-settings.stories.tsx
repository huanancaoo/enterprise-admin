import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within, waitFor } from "storybook/test"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import {
  createWebhooksScenario,
  webhookSigningSecret,
  taskCenterOrganizationId,
  taskCenterUser,
} from "@workspace/mocks"
import { WebhooksSettings } from "./webhooks-settings"
function WebhooksStory() {
  const [client] = useState(createWorkspaceAuthClient)
  return (
    <AuthenticatedSessionProvider client={client} user={taskCenterUser}>
      <WebhooksSettings organizationId={taskCenterOrganizationId} />
    </AuthenticatedSessionProvider>
  )
}
const fixture = createWebhooksScenario()
const meta = {
  title: "Admin/Webhooks",
  component: WebhooksStory,
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof WebhooksStory>
export default meta
type Story = StoryObj<typeof meta>
export const CreatesAndDestroysOneTimeSecret: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Create webhook" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole("dialog")
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Accounting events"
    )
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Destination URL" }),
      "https://receiver.example.test/events"
    )
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Project created" })
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save webhook" })
    )
    await waitFor(() =>
      expect(body.getByRole("textbox", { name: "Signing secret" })).toHaveValue(
        webhookSigningSecret
      )
    )
    await userEvent.click(body.getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(
        body.queryByRole("textbox", { name: "Signing secret" })
      ).not.toBeInTheDocument()
    )
    await expect(await canvas.findByText("Accounting events")).toBeVisible()
  },
}

const populated = createWebhooksScenario("populated")
export const EditsAndDisablesSubscription: Story = {
  beforeEach: populated.reset,
  parameters: { msw: { handlers: populated.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit webhook" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole("dialog")
    const name = within(dialog).getByRole("textbox", { name: "Name" })
    await userEvent.clear(name)
    await userEvent.type(name, "Paused bridge")
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Enable delivery" })
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Save webhook" })
    )
    await expect(await canvas.findByText("Paused bridge")).toBeVisible()
    await expect(canvas.getByText("Disabled")).toBeVisible()
    expect(
      body.queryByRole("textbox", { name: "Signing secret" })
    ).not.toBeInTheDocument()
  },
}
export const ReadsHistoryAndDeletesSubscription: Story = {
  beforeEach: populated.reset,
  parameters: { msw: { handlers: populated.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Delivery history" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const history = await body.findByRole("dialog")
    await waitFor(() =>
      expect(within(history).getByText("No results")).toBeVisible()
    )
    await userEvent.click(
      within(history).getByRole("button", { name: "Close" })
    )
    await waitFor(() =>
      expect(body.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Delete webhook" })
    )
    const confirmation = await body.findByRole("alertdialog")
    await userEvent.click(
      within(confirmation).getByRole("button", { name: "Delete webhook" })
    )
    await waitFor(() =>
      expect(canvas.queryByText("Accounting events")).not.toBeInTheDocument()
    )
  },
}
