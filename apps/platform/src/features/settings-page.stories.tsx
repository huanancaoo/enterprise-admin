import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createPlatformSettingsScenario,
  createWorkspaceSessionHandlers,
  type PlatformSettingsScenario,
} from "@workspace/mocks"
import { PlatformReadPageStory } from "./platform-read-page.story-fixture"

const scenario = (name: PlatformSettingsScenario = "success") => {
  const fixture = createPlatformSettingsScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: {
      layout: "fullscreen",
      msw: {
        handlers: [...fixture.handlers, ...createWorkspaceSessionHandlers()],
      },
    },
  }
}
const meta = {
  title: "Platform/Settings",
  component: PlatformReadPageStory,
  args: { page: "settings" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof PlatformReadPageStory>
export default meta
type Story = StoryObj<typeof meta>

const loaded: Story["play"] = async ({ canvasElement }) => {
  await within(canvasElement).findByText("production")
}
const readError: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible()
  await expect(canvas.queryByText("production")).toBeNull()
}
async function draft(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const reason = await canvas.findByRole("textbox", {
    name: "Reason for change",
  })
  await userEvent.type(reason, "Review default language setting")
  return {
    canvas,
    reason,
    submit: canvas.getByRole("button", { name: "Save" }),
  }
}
export const Default: Story = { play: loaded }
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveAttribute("aria-busy", "true")
  },
}
// 设置是必有的单例；空配置展示未配置 SMTP，不伪造不存在的设置记录。
export const Empty: Story = {
  ...scenario("emptyConfiguration"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Not configured")
    await expect(canvas.getByText("production")).toBeVisible()
  },
}
export const Error: Story = { ...scenario("unavailable"), play: readError }
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByText("production")).toBeNull()
  },
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Sign in" })
    await expect(canvas.queryByText("production")).toBeNull()
  },
}
export const ReadOnly: Story = {
  args: { auditor: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(
      "Your platform auditor role can view these settings."
    )
    await expect(canvas.queryByRole("textbox")).toBeNull()
    await expect(canvas.queryByRole("button", { name: "Save" })).toBeNull()
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("staging-".repeat(24))
    await expect(canvas.getByText("2026.10.02-".repeat(24))).toBeVisible()
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("production")
    await expect(
      canvas.getByRole("heading", { name: "إعدادات المنصة" })
    ).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("production")
    await expect(
      canvas.getByRole("heading", { name: "平台设置" })
    ).toBeVisible()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("status")).toHaveAttribute(
      "aria-busy",
      "true"
    )
    await canvas.findByText("production")
  },
}
export const ReadRetry: Story = {
  ...scenario("retryable"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("alert")
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await canvas.findByText("production")
  },
}
export const SaveWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, reason, submit } = await draft(canvasElement)
    await userEvent.click(canvas.getByRole("combobox"))
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await screen.findByRole("option", { name: "English" })
    )
    submit.focus()
    await userEvent.keyboard("{Enter}")
    await expect(submit).toBeDisabled()
    await expect(reason).toBeDisabled()
    await expect(canvas.getByRole("combobox")).toBeDisabled()
    await expect(reason).toHaveValue("Review default language setting")
    await waitFor(() =>
      expect(canvas.getByRole("status")).toHaveTextContent(
        "Platform default language saved."
      )
    )
    await expect(
      canvas.getByRole("textbox", { name: "Reason for change" })
    ).toHaveValue("")
    await expect(canvas.getByRole("combobox")).toHaveTextContent("English")
  },
}
export const SaveLoading: Story = {
  ...scenario("saveLoading"),
  play: async ({ canvasElement }) => {
    const { canvas, reason, submit } = await draft(canvasElement)
    await userEvent.click(submit)
    await expect(reason).toBeDisabled()
    await expect(canvas.getByRole("combobox")).toBeDisabled()
    await expect(
      canvas.getByRole("button", { name: "Submitting…" })
    ).toBeDisabled()
  },
}
export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, reason, submit } = await draft(canvasElement)
    await userEvent.clear(reason)
    await userEvent.type(reason, "          ")
    await userEvent.click(submit)
    await canvas.findByText("Enter a reason with 10–500 characters.")
    await expect(reason).toHaveValue("          ")
    await expect(reason).toHaveAttribute("aria-invalid", "true")
  },
}
export const StaleVersion: Story = {
  ...scenario("stale"),
  play: async ({ canvasElement }) => {
    const { canvas, reason, submit } = await draft(canvasElement)
    await userEvent.click(submit)
    await canvas.findByRole("alert")
    await expect(reason).toHaveValue("Review default language setting")
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Discard draft and reload latest settings",
      })
    )
    await waitFor(() => expect(reason).not.toBeInTheDocument())
    await expect(
      canvas.getByRole("textbox", { name: "Reason for change" })
    ).toHaveValue("")
    await expect(canvas.getByRole("combobox")).toHaveTextContent("العربية")
  },
}
const retrySave: Story["play"] = async ({ canvasElement }) => {
  const { canvas, reason, submit } = await draft(canvasElement)
  await userEvent.click(submit)
  await canvas.findByRole("alert")
  await expect(reason).toHaveValue("Review default language setting")
  await expect(submit).toBeEnabled()
  await userEvent.click(submit)
  await waitFor(() =>
    expect(canvas.getByRole("status")).toHaveTextContent(
      "Platform default language saved."
    )
  )
  await expect(
    canvas.getByRole("textbox", { name: "Reason for change" })
  ).toHaveValue("")
}
export const RateLimited: Story = {
  ...scenario("rateLimited"),
  play: retrySave,
}
export const SaveUnavailable: Story = {
  ...scenario("saveUnavailable"),
  play: retrySave,
}
export const SavePermissionDenied: Story = {
  ...scenario("saveForbidden"),
  play: async ({ canvasElement }) => {
    const { canvas, submit } = await draft(canvasElement)
    await userEvent.click(submit)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByText("production")).toBeNull()
    await expect(canvas.queryByRole("textbox")).toBeNull()
  },
}
export const SaveSessionExpired: Story = {
  ...scenario("saveUnauthorized"),
  play: async ({ canvasElement }) => {
    const { canvas, submit } = await draft(canvasElement)
    await userEvent.click(submit)
    await canvas.findByRole("heading", { name: "Sign in" })
    await expect(canvas.queryByText("production")).toBeNull()
  },
}
export const RecentMfaRequired: Story = {
  ...scenario("mfaRequired"),
  play: async ({ canvasElement }) => {
    const { canvas, submit } = await draft(canvasElement)
    await userEvent.click(submit)
    await canvas.findByRole("heading", {
      name: "Verify your platform identity",
    })
    await expect(canvas.queryByText("production")).toBeNull()
  },
}
