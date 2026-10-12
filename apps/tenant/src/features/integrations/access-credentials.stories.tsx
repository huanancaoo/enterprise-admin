import { focusManager } from "@tanstack/react-query"
import { useState } from "react"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { authClient } from "../../lib/auth-client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within, waitFor } from "storybook/test"
import {
  createAccessCredentialsScenario,
  accessCredentialOrganizationId,
  accessCredentialUser,
  otherAccessCredentialUser,
} from "@workspace/mocks"
import { AccessCredentialsSettings } from "./access-credentials"

const organizationId = accessCredentialOrganizationId
const fixture = createAccessCredentialsScenario()
const meta = {
  title: "Admin/API credentials",
  component: AccessCredentialsSettings,
  args: { organizationId },
  decorators: [
    (Story) => (
      <AuthenticatedSessionProvider
        client={authClient}
        user={accessCredentialUser}
      >
        <Story />
      </AuthenticatedSessionProvider>
    ),
  ],
  globals: { locale: "en-US" },
  beforeEach: fixture.reset,
  parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
} satisfies Meta<typeof AccessCredentialsSettings>
export default meta
type Story = StoryObj<typeof meta>
export const CreatesOneTimeKey: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Create credential" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole("dialog")
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Name" }),
      "Accounting bridge"
    )
    const expiry = within(dialog).getByLabelText("Expires at")
    await userEvent.type(expiry, "2030-01-01T00:00")
    await userEvent.click(
      within(dialog).getByRole("checkbox", { name: "Projects: Read" })
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create credential" })
    )
    const secret = await body.findByRole("textbox", { name: "Key" })
    await expect(secret).toHaveValue("ea_story_fixture_not_a_real_key")
    await userEvent.click(body.getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(body.queryByRole("textbox", { name: "Key" })).toBeNull()
    )
  },
}

const populated = createAccessCredentialsScenario("populated")
export const RevokesCredential: Story = {
  beforeEach: populated.reset,
  parameters: { msw: { handlers: populated.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Accounting bridge")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Revoke" }))
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole("alertdialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Revoke" })
    )
    await waitFor(() => expect(body.queryByRole("alertdialog")).toBeNull())
    await waitFor(() => {
      expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "false")
      expect(canvas.getByText("Revoked")).toBeVisible()
      expect(canvas.queryByRole("button", { name: "Revoke" })).toBeNull()
    })
  },
}

const createError = createAccessCredentialsScenario("create-error")
export const KeepsFailedDraft: Story = {
  beforeEach: createError.reset,
  parameters: { msw: { handlers: createError.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Create credential" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const dialog = await body.findByRole("dialog")
    const form = within(dialog)
    await userEvent.type(
      form.getByRole("textbox", { name: "Name" }),
      "Accounting bridge"
    )
    await userEvent.type(form.getByLabelText("Expires at"), "2030-01-01T00:00")
    await userEvent.click(
      form.getByRole("checkbox", { name: "Projects: Read" })
    )
    await userEvent.click(
      form.getByRole("button", { name: "Create credential" })
    )
    await expect(await form.findByRole("alert")).toHaveTextContent(
      "The credential could not be created. Your input has been kept."
    )
    await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Accounting bridge"
    )
    await expect(
      form.getByRole("checkbox", { name: "Projects: Read" })
    ).toBeChecked()
    await expect(body.queryByRole("textbox", { name: "Key" })).toBeNull()
    await userEvent.click(form.getByRole("button", { name: "Cancel" }))
  },
}

const readOnly = createAccessCredentialsScenario("read-only")
export const ReadOnlyCredentials: Story = {
  beforeEach: readOnly.reset,
  parameters: { msw: { handlers: readOnly.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Accounting bridge")).toBeVisible()
    await expect(
      canvas.getByText(
        "You can view credentials, but cannot create or revoke them."
      )
    ).toBeVisible()
    await expect(
      canvas.queryByRole("button", { name: "Create credential" })
    ).toBeNull()
    await expect(canvas.queryByRole("button", { name: "Revoke" })).toBeNull()
  },
}

const forbidden = createAccessCredentialsScenario("forbidden")
export const DeniedCredentials: Story = {
  beforeEach: forbidden.reset,
  parameters: { msw: { handlers: forbidden.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Access denied")).toBeVisible()
    await expect(canvas.queryByText("Accounting bridge")).toBeNull()
    await expect(
      canvas.queryByRole("button", { name: "Create credential" })
    ).toBeNull()
  },
}

const loadError = createAccessCredentialsScenario("load-error")
export const FailedListing: Story = {
  beforeEach: loadError.reset,
  parameters: { msw: { handlers: loadError.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "API credentials could not be loaded."
    )
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible()
    await expect(canvas.queryByText("Accounting bridge")).toBeNull()
  },
}

export const ArabicCredentials: Story = {
  globals: { locale: "ar" },
  beforeEach: populated.reset,
  parameters: { msw: { handlers: populated.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Accounting bridge")).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await expect(
      canvas.getByRole("heading", { name: "بيانات اعتماد واجهة API" })
    ).toBeVisible()
  },
}

const paginated = createAccessCredentialsScenario("paginated")
export const PaginatesMetadata: Story = {
  beforeEach: paginated.reset,
  parameters: { msw: { handlers: paginated.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText("Accounting bridge 1", { exact: true })
    ).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await expect(
      await canvas.findByText("Accounting bridge 21", { exact: true })
    ).toBeVisible()
    await expect(
      canvas.queryByText("Accounting bridge 1", { exact: true })
    ).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toHaveAttribute("aria-disabled", "true")
  },
}

const subjectChange = createAccessCredentialsScenario("populated")
function ChangesSubject({ organizationId }: { organizationId: string }) {
  const [user, setUser] = useState(accessCredentialUser)
  return (
    <AuthenticatedSessionProvider client={authClient} user={user}>
      <button
        onClick={() => {
          subjectChange.switchAccount()
          setUser(otherAccessCredentialUser)
        }}
      >
        {otherAccessCredentialUser.name}
      </button>
      <AccessCredentialsSettings organizationId={organizationId} />
    </AuthenticatedSessionProvider>
  )
}
export const AccountScopedMetadata: Story = {
  render: (args) => <ChangesSubject {...args} />,
  beforeEach: subjectChange.reset,
  parameters: { msw: { handlers: subjectChange.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Accounting bridge")).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Second account" })
    )
    await expect(
      await canvas.findByText("Second account integration")
    ).toBeVisible()
    await expect(canvas.queryByText("Accounting bridge")).toBeNull()
  },
}

const deniedAfterIssue = createAccessCredentialsScenario()
export const LostAccessDestroysKey: Story = {
  beforeEach: deniedAfterIssue.reset,
  parameters: { msw: { handlers: deniedAfterIssue.handlers } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Create credential" })
    )
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole("dialog"))
    await userEvent.type(
      dialog.getByRole("textbox", { name: "Name" }),
      "Accounting bridge"
    )
    await userEvent.type(
      dialog.getByLabelText("Expires at"),
      "2030-01-01T00:00"
    )
    await userEvent.click(
      dialog.getByRole("checkbox", { name: "Projects: Read" })
    )
    await userEvent.click(
      dialog.getByRole("button", { name: "Create credential" })
    )
    await waitFor(() =>
      expect(body.getByRole("textbox", { name: "Key" })).toBeVisible()
    )
    await canvas.findByText("Accounting bridge")
    deniedAfterIssue.denyMetadata()
    // 浏览器 runner 的 tab 可处于后台；通过公开 focus API 触发确定的重新读取。
    focusManager.setFocused(false)
    focusManager.setFocused(true)
    try {
      await expect(await canvas.findByText("Access denied")).toBeVisible()
      await expect(body.queryByRole("textbox", { name: "Key" })).toBeNull()
      await expect(canvas.queryByText("Accounting bridge")).toBeNull()
    } finally {
      focusManager.setFocused(undefined)
    }
  },
}
