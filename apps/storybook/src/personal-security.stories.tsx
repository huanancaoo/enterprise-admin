import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import { PersonalSecuritySettings } from "@workspace/admin"
import { createPersonalSecurityScenario, securityUser } from "@workspace/mocks"
const authClient = createWorkspaceAuthClient()

function PersonalSecurityStory() {
  const session = authClient.useSession()
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={session.data?.user ?? securityUser}
    >
      <main className="p-6">
        <PersonalSecuritySettings client={authClient} />
      </main>
    </AuthenticatedSessionProvider>
  )
}
const fixture = createPersonalSecurityScenario()
const meta = {
  title: "Admin/Account security",
  component: PersonalSecurityStory,
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof PersonalSecurityStory>
export default meta
type Story = StoryObj<typeof meta>
export const PasswordChangeKeepsCurrentBrowser: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const current = await canvas.findByLabelText("Current password")
    await userEvent.type(current, "Current-password-123")
    await userEvent.type(
      canvas.getByLabelText("New password"),
      "New-password-456"
    )
    await userEvent.type(
      canvas.getByLabelText("Confirm new password"),
      "New-password-456"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Change password" })
    )
    await expect(
      await canvas.findByText(
        "Password changed. Other sessions have been signed out."
      )
    ).toBeVisible()
    await expect(current).toHaveValue("")
    await expect(await canvas.findByText("Current browser")).toBeVisible()
    await expect(canvas.queryByText("Other browser")).toBeNull()
  },
}

export const EmailChangeWaitsForNativeVerification: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      await canvas.findByLabelText("New email address"),
      "replacement@example.test"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Change email" }))
    await expect(
      await canvas.findByText(
        "Check replacement@example.test to verify your new email address. Your current email stays active until verification."
      )
    ).toBeVisible()
    await expect(canvas.getByText("security@example.test")).toBeVisible()
  },
}

export const RevokeOtherBrowser: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const device = await canvas.findByText("Other browser")
    const row = device.closest("li")!
    await userEvent.click(
      within(row).getByRole("button", { name: "Sign out session" })
    )
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "alertdialog"
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Sign out" })
    )
    await within(canvasElement.ownerDocument.body).findByText(
      "Session signed out."
    )
    await expect(canvas.queryByText("Other browser")).toBeNull()
    await expect(canvas.getByText("Current browser")).toBeVisible()
  },
}

export const WrongPasswordKeepsDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const current = await canvas.findByLabelText("Current password")
    const replacement = canvas.getByLabelText("New password")
    await userEvent.type(current, "Incorrect-password-123")
    await userEvent.type(replacement, "New-password-456")
    await userEvent.type(
      canvas.getByLabelText("Confirm new password"),
      "New-password-456"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Change password" })
    )
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Incorrect current password."
    )
    await expect(current).toHaveValue("Incorrect-password-123")
    await expect(replacement).toHaveValue("New-password-456")
    await expect(canvas.getByText("Other browser")).toBeVisible()
  },
}
const slowPassword = createPersonalSecurityScenario("slow-password")
export const PasswordSubmissionLocksFields: Story = {
  beforeEach: slowPassword.reset,
  parameters: { msw: { handlers: slowPassword.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const current = await canvas.findByLabelText("Current password")
    await userEvent.type(current, "Current-password-123")
    await userEvent.type(
      canvas.getByLabelText("New password"),
      "New-password-456"
    )
    await userEvent.type(
      canvas.getByLabelText("Confirm new password"),
      "New-password-456"
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Change password" })
    )
    await waitFor(() => expect(current).toBeDisabled())
    await expect(canvas.getByLabelText("New password")).toBeDisabled()
    await expect(canvas.getByRole("button", { name: "Saving…" })).toBeDisabled()
  },
}
const emailFailure = createPersonalSecurityScenario("email-error")
export const EmailFailureKeepsDraft: Story = {
  beforeEach: emailFailure.reset,
  parameters: { msw: { handlers: emailFailure.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText("New email address")
    await userEvent.type(input, "replacement@example.test")
    await userEvent.click(canvas.getByRole("button", { name: "Change email" }))
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Email change failed."
    )
    await expect(input).toHaveValue("replacement@example.test")
    await expect(canvas.getByText("security@example.test")).toBeVisible()
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByLabelText("当前密码")
    await within(canvasElement).findByLabelText("新邮箱地址")
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByLabelText("كلمة المرور الحالية")
    await expect(document.documentElement).toHaveAttribute("dir", "rtl")
  },
}
