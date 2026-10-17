import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createPlatformEntityComboboxScenario,
  createPlatformIdentityScenario,
  createPlatformUsersScenario,
  createWorkspaceSessionHandlers,
  type PlatformIdentityScenario,
} from "@workspace/mocks"
import { PlatformReadPageStory } from "../platform-read-page.story-fixture"

const createScenario = (name: PlatformIdentityScenario = "success") => {
  const identity = createPlatformIdentityScenario(name)
  const directory = createPlatformEntityComboboxScenario()
  const users = createPlatformUsersScenario()
  return {
    fixture: identity,
    story: {
      beforeEach: () => {
        identity.reset()
        directory.reset()
        users.reset()
      },
      parameters: {
        layout: "fullscreen",
        msw: {
          handlers: [
            ...identity.handlers,
            ...directory.handlers,
            ...users.handlers,
            ...createWorkspaceSessionHandlers(),
          ],
        },
      },
    },
  }
}

const defaultScenario = createScenario()
const meta = {
  title: "Platform/Identity",
  component: PlatformReadPageStory,
  globals: { locale: "en-US" },
  ...defaultScenario.story,
  parameters: {
    ...defaultScenario.story.parameters,
    a11y: { test: "error" },
  },
} satisfies Meta<typeof PlatformReadPageStory>
export default meta
type Story = StoryObj<typeof meta>

export const LoginEvents: Story = {
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Login history" })
    await canvas.findByRole("table")
    await canvas.findByText("Platform Operator")
    await expect(canvas.getByRole("button", { name: "Method" })).toBeVisible()
  },
}

const paginatedFixture = createScenario("success")
export const LoginEventsFilterPagination: Story = {
  ...paginatedFixture.story,
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await expect(
      paginatedFixture.fixture.loginQueries.at(-1)?.get("page")
    ).toBe("2")
    await userEvent.click(canvas.getByRole("button", { name: "Previous page" }))
    await userEvent.click(canvas.getByRole("button", { name: "Result" }))
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(await screen.findByRole("option", { name: "Failed" }))
    await expect(
      paginatedFixture.fixture.loginQueries.at(-1)?.get("result")
    ).toBe("failed")
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(8))
    const search = canvas.getByRole("textbox", {
      name: "Search account, email, or IP",
    })
    await userEvent.type(search, "192.0.2.12")
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(paginatedFixture.fixture.loginQueries.at(-1)?.get("q")).toBe(
        "192.0.2.12"
      )
    )
    await expect(
      paginatedFixture.fixture.loginQueries.at(-1)?.get("result")
    ).toBe("failed")
  },
}

export const PersonalAccountRows: Story = {
  ...createScenario("success").story,
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(canvas.getByText("Platform account")).toBeVisible()
    await expect(canvas.getByText("—")).toBeVisible()
  },
}

export const LoginEventsLoading: Story = {
  ...createScenario("loading").story,
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    const status = await within(canvasElement).findByRole("status")
    await expect(status.closest("[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "true"
    )
  },
}

export const LoginEventsEmpty: Story = {
  ...createScenario("empty").story,
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No data yet")
  },
}

export const LoginEventsError: Story = {
  ...createScenario("unavailable").story,
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("alert")
    await canvas.findByRole("button", { name: "Retry" })
  },
}

export const LoginEventsForbidden: Story = {
  ...createScenario("forbidden").story,
  args: { page: "login-events" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}

const sessionFixture = createScenario("success")
export const Sessions: Story = {
  ...sessionFixture.story,
  args: { page: "sessions" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Global sessions" })
    await canvas.findByRole("table")
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revoke session" })
    )
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog")
    await expect(dialog).toBeVisible()
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Confirm" })
    )
    await within(canvasElement.ownerDocument.body).findByText(
      "Session revoked."
    )
    await expect(canvas.getByRole("table")).toBeVisible()
    await expect(sessionFixture.fixture.revokedSessionIds).toEqual([
      "c7dd0a27-4f8a-4aef-8d4c-000000003001",
    ])
  },
}

export const SessionRevokePending: Story = {
  ...createScenario("revokeSlow").story,
  args: { page: "sessions" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revoke session" })
    )
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Confirm" })
    )
    await expect(
      within(dialog).getByRole("button", { name: "Confirm" })
    ).toBeDisabled()
  },
}

export const SessionRevokeError: Story = {
  ...createScenario("revokeFailure").story,
  args: { page: "sessions" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revoke session" })
    )
    const dialog = within(canvasElement.ownerDocument.body).getByRole("dialog")
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Confirm" })
    )
    await within(dialog).findByRole("alert")
    await expect(dialog).toBeVisible()
  },
}

export const SessionsReadOnlyAuditor: Story = {
  args: { page: "sessions", auditor: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(
      canvas.queryByRole("button", { name: "Revoke session" })
    ).toBeNull()
  },
}

export const IdentityLoading: Story = {
  ...createScenario("loading").story,
  args: { page: "sessions" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("status")
  },
}

export const IdentityEmpty: Story = {
  ...createScenario("empty").story,
  args: { page: "sessions" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No data yet")
  },
}

export const IdentityError: Story = {
  ...createScenario("unavailable").story,
  args: { page: "sessions" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("alert")
    await canvas.findByRole("button", { name: "Retry" })
  },
}

export const RTL: Story = {
  args: { page: "sessions" },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("table")
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
