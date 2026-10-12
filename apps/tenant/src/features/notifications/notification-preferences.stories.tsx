import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import { createNotificationPreferencesScenario } from "@workspace/mocks"
import { NotificationPreferencesSettings } from "./notification-preferences"
const organizationId = "c7dd0a27-4f8a-4aef-8d4c-000000000001"
const user = {
  id: "e430c8b4-8de4-4eb4-a0f2-c5017656a700",
  name: "Notification member",
  email: "notify@example.test",
}
function PreferenceStory() {
  const [client] = useState(createWorkspaceAuthClient)
  return (
    <AuthenticatedSessionProvider client={client} user={user}>
      <main className="max-w-xl p-6">
        <NotificationPreferencesSettings organizationId={organizationId} />
      </main>
    </AuthenticatedSessionProvider>
  )
}
const fixture = createNotificationPreferencesScenario()
const meta = {
  title: "Admin/Notification preferences",
  component: PreferenceStory,
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof PreferenceStory>
export default meta
type Story = StoryObj<typeof meta>
export const SaveEmailPreference: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = await canvas.findByRole("checkbox", {
      name: "Email task results",
    })
    await expect(checkbox).not.toBeChecked()
    await userEvent.click(checkbox)
    await userEvent.click(
      canvas.getByRole("button", { name: "Save notification preferences" })
    )
    await expect(
      await canvas.findByText("Notification preferences saved.")
    ).toBeVisible()
    await expect(checkbox).toBeChecked()
  },
}
const failure = createNotificationPreferencesScenario("error")
export const SaveFailureKeepsSelection: Story = {
  beforeEach: failure.reset,
  parameters: { msw: { handlers: failure.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = await canvas.findByRole("checkbox", {
      name: "Email task results",
    })
    await userEvent.click(checkbox)
    await userEvent.click(
      canvas.getByRole("button", { name: "Save notification preferences" })
    )
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Notification preference save failed."
    )
    await expect(checkbox).toBeChecked()
  },
}
const pending = createNotificationPreferencesScenario("pending")
export const LocksPendingSelection: Story = {
  beforeEach: pending.reset,
  parameters: { msw: { handlers: pending.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const checkbox = await canvas.findByRole("checkbox", {
      name: "Email task results",
    })
    await userEvent.click(checkbox)
    const submit = canvas.getByRole("button", {
      name: "Save notification preferences",
    })
    await userEvent.click(submit)
    await waitFor(() =>
      expect(checkbox).toHaveAttribute("aria-disabled", "true")
    )
    await expect(submit).toBeDisabled()
    await expect(
      await canvas.findByText("Notification preferences saved.")
    ).toBeVisible()
  },
}
