import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within, fn, userEvent } from "storybook/test"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  createNotificationCenterScenario,
  notificationOrganizationId,
  notificationUser,
  notificationTaskId,
} from "@workspace/mocks"
import { authClient } from "../../lib/auth-client"
import { NotificationCenter } from "./notification-center"
const fixture = createNotificationCenterScenario()
function NotificationStory(
  args: Omit<
    Parameters<typeof NotificationCenter>[0],
    "search" | "onSearchChange"
  >
) {
  const [search, onSearchChange] = useState({ page: 1, pageSize: 20 })
  return (
    <AuthenticatedSessionProvider client={authClient} user={notificationUser}>
      <main className="p-6">
        <NotificationCenter
          {...args}
          search={search}
          onSearchChange={onSearchChange}
        />
      </main>
    </AuthenticatedSessionProvider>
  )
}
const meta = {
  title: "Admin/Notifications",
  component: NotificationStory,
  args: { organizationId: notificationOrganizationId, onOpenTask: fn() },
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof NotificationStory>
export default meta
type Story = StoryObj<typeof meta>
export const OwnUnreadNotification: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole("heading", { name: "Notifications", level: 1 })
    ).toBeVisible()
    await expect(await canvas.findByText("1 unread")).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Projects export completed" })
    )
    await expect(args.onOpenTask).toHaveBeenCalledWith(notificationTaskId)
    await expect(
      canvas.getByRole("button", { name: "Mark as read" })
    ).toBeVisible()
  },
}

export const MarksNotificationRead: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Mark as read" })
    )
    await expect(await canvas.findByText("0 unread")).toBeVisible()
    await expect(canvas.getByText("Read", { exact: true })).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Mark as read" })
    ).toBeNull()
  },
}

const readFailure = createNotificationCenterScenario("read-error")
export const ReadFailureRetriesWithoutChangingStatus: Story = {
  beforeEach: readFailure.reset,
  parameters: { msw: { handlers: readFailure.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Mark as read" })
    )
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Marking as read failed. Please try again."
    )
    await expect(canvas.getByText("1 unread")).toBeVisible()
    await expect(canvas.getByText("Unread", { exact: true })).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Mark as read" }))
    await expect(await canvas.findByText("0 unread")).toBeVisible()
    await expect(canvas.queryByRole("alert")).toBeNull()
  },
}

const empty = createNotificationCenterScenario("empty")
export const EmptyInbox: Story = {
  beforeEach: empty.reset,
  parameters: { msw: { handlers: empty.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("No notifications yet.")).toBeVisible()
    await expect(canvas.getByText("0 unread")).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Mark as read" })
    ).toBeNull()
  },
}

const denied = createNotificationCenterScenario("denied")
export const DeniedInbox: Story = {
  beforeEach: denied.reset,
  parameters: { msw: { handlers: denied.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Access denied")).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Projects export completed" })
    ).toBeNull()
  },
}

const paginated = createNotificationCenterScenario("paginated")
export const PaginatesOwnNotifications: Story = {
  beforeEach: paginated.reset,
  parameters: { msw: { handlers: paginated.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findAllByRole("button", {
        name: "Projects export completed",
      })
    ).toHaveLength(20)
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await expect(
      await canvas.findByRole("button", { name: "Projects import failed" })
    ).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Projects export completed" })
    ).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toHaveAttribute("aria-disabled", "true")
  },
}

const loading = createNotificationCenterScenario("loading")
export const LoadingInbox: Story = {
  beforeEach: loading.reset,
  parameters: { msw: { handlers: loading.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole("heading", { name: "Notifications", level: 1 })
    ).toBeVisible()
    await expect(
      (await canvas.findByRole("table")).closest("fieldset")
    ).toHaveAttribute("aria-busy", "true")
    await expect(
      canvas.queryByRole("button", { name: "Projects export completed" })
    ).toBeNull()
  },
}

const loadError = createNotificationCenterScenario("load-error")
export const FailedInbox: Story = {
  beforeEach: loadError.reset,
  parameters: { msw: { handlers: loadError.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Notifications could not be loaded."
    )
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Projects export completed" })
    ).toBeNull()
  },
}

export const ArabicInbox: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole("heading", { name: "الإشعارات", level: 1 })
    ).toBeVisible()
    await expect(
      await canvas.findByRole("button", { name: "اكتمل تصدير المشاريع" })
    ).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await expect(
      canvas.getByRole("button", { name: "وضع علامة مقروء" })
    ).toBeVisible()
  },
}

const readDenied = createNotificationCenterScenario("read-denied")
export const LostMembershipOnRead: Story = {
  beforeEach: readDenied.reset,
  parameters: { msw: { handlers: readDenied.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Mark as read" })
    )
    await expect(await canvas.findByText("Access denied")).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Projects export completed" })
    ).toBeNull()
  },
}
