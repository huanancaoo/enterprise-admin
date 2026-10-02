import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createPlatformUsersScenario,
  createWorkspaceSessionHandlers,
  platformUserFixture,
  platformUserFullEmail,
  type PlatformUsersScenario,
} from "@workspace/mocks"
import { PlatformReadPageStory } from "../platform-read-page.story-fixture"

const scenario = (name: PlatformUsersScenario = "success") => {
  const fixture = createPlatformUsersScenario(name)
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
  title: "Platform/Users",
  component: PlatformReadPageStory,
  args: { page: "users" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof PlatformReadPageStory>
export default meta
type Story = StoryObj<typeof meta>

const detailPlay: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("heading", { name: platformUserFixture.name })
  await expect(canvas.queryByText(platformUserFullEmail)).toBeNull()
}
const loadingPlay: Story["play"] = async ({ canvasElement }) => {
  await expect(
    await within(canvasElement).findByRole("status")
  ).toHaveAttribute("aria-busy", "true")
}
const errorPlay: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible()
}
async function closed(screen: ReturnType<typeof within>) {
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { hidden: true })
    ).not.toBeInTheDocument()
  )
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("link", { name: platformUserFixture.name })
    )
    await canvas.findByRole("heading", { name: platformUserFixture.name })
    await expect(
      canvas.getByRole("heading", { name: "Organization memberships" })
    ).toBeVisible()
    await expect(canvas.getByText("North workspace")).toBeVisible()
    await expect(canvas.getByText("South workspace")).toBeVisible()
    await expect(canvas.queryByText(platformUserFullEmail)).toBeNull()
  },
}
export const Loading: Story = { ...scenario("loading"), play: loadingPlay }
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "No results" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const Error: Story = { ...scenario("unavailable"), play: errorPlay }
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Sign in" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("link", {
      name: /国际研发与合规协作成员/,
    })
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("link", { name: platformUserFixture.name })
    await expect(
      canvas.getByRole("heading", { name: "المستخدمون" })
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
    await canvas.findByRole("link", { name: platformUserFixture.name })
    await expect(canvas.getByRole("heading", { name: "用户" })).toBeVisible()
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
    await canvas.findByRole("link", { name: platformUserFixture.name })
  },
}
export const Detail: Story = { args: { detail: true }, play: detailPlay }
export const DetailLoading: Story = {
  args: { detail: true },
  ...scenario("loading"),
  play: loadingPlay,
}
export const DetailEmptyMemberships: Story = {
  args: { detail: true },
  ...scenario("noMemberships"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "No results" })
    await expect(
      canvas.getByRole("heading", { name: platformUserFixture.name })
    ).toBeVisible()
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const DetailError: Story = {
  args: { detail: true },
  ...scenario("unavailable"),
  play: errorPlay,
}
export const DetailPermissionDenied: Story = {
  ...PermissionDenied,
  args: { detail: true },
}
export const DetailSessionExpired: Story = {
  ...SessionExpired,
  args: { detail: true },
}
export const DetailNotFound: Story = {
  args: { detail: true },
  ...scenario("notFound"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("heading", {
      name: "Page not found",
    })
  },
}
export const DetailLongText: Story = {
  args: { detail: true },
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", {
      name: /国际研发与合规协作成员/,
    })
    const table = canvas.getByRole("table")
    table.focus()
    await expect(table).toHaveFocus()
  },
}
export const DetailRTL: Story = {
  ...RTL,
  args: { detail: true },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("heading", {
      name: platformUserFixture.name,
    })
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const Unverified: Story = {
  args: { detail: true },
  ...scenario("unverified"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Unverified")
    await expect(canvas.getByText("Disabled")).toBeVisible()
  },
}
export const ReadOnly: Story = {
  args: { detail: true, auditor: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: platformUserFixture.name })
    await expect(
      canvas.queryByRole("button", { name: "View full email" })
    ).toBeNull()
    await expect(canvas.queryByText(platformUserFullEmail)).toBeNull()
  },
}

async function sensitive(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const screen = within(canvasElement.ownerDocument.body)
  await userEvent.click(
    await canvas.findByRole("button", { name: "View full email" })
  )
  const dialog = within(await screen.findByRole("dialog"))
  const purpose = dialog.getByRole("textbox", { name: "Purpose of access" })
  await userEvent.type(purpose, "Investigate the user's support request")
  return {
    canvas,
    screen,
    dialog,
    purpose,
    submit: dialog.getByRole("button", { name: "View full email" }),
  }
}
export const SensitiveReadWithKeyboard: Story = {
  args: { detail: true },
  play: async ({ canvasElement }) => {
    const { canvas, screen, dialog, purpose, submit } =
      await sensitive(canvasElement)
    submit.focus()
    await userEvent.keyboard("{Enter}")
    await expect(purpose).toBeDisabled()
    await expect(submit).toBeDisabled()
    await dialog.findByText(platformUserFullEmail)
    await userEvent.keyboard("{Escape}")
    await closed(screen)
    await expect(canvas.queryByText(platformUserFullEmail)).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "View full email" })
    ).toHaveFocus()
    await userEvent.click(
      canvas.getByRole("button", { name: "View full email" })
    )
    const reopened = within(await screen.findByRole("dialog"))
    await expect(
      reopened.getByRole("textbox", { name: "Purpose of access" })
    ).toHaveValue("")
    await expect(reopened.queryByText(platformUserFullEmail)).toBeNull()
    await userEvent.click(reopened.getByRole("button", { name: "Close" }))
    await closed(screen)
  },
}
export const SensitiveLoading: Story = {
  args: { detail: true },
  ...scenario("sensitiveLoading"),
  play: async ({ canvasElement }) => {
    const { dialog, purpose, submit } = await sensitive(canvasElement)
    await userEvent.click(submit)
    await expect(purpose).toBeDisabled()
    await expect(submit).toBeDisabled()
    await expect(dialog.queryByText(platformUserFullEmail)).toBeNull()
  },
}
export const SensitiveValidationError: Story = {
  args: { detail: true },
  play: async ({ canvasElement }) => {
    const { dialog, purpose, submit } = await sensitive(canvasElement)
    await userEvent.clear(purpose)
    await userEvent.type(purpose, "   ")
    await userEvent.click(submit)
    await dialog.findByText("Enter a purpose between 1 and 500 characters.")
    await expect(dialog.queryByText(platformUserFullEmail)).toBeNull()
    await expect(purpose).toHaveValue("   ")
  },
}
const sensitiveRetry: Story["play"] = async ({ canvasElement }) => {
  const { screen, dialog, purpose, submit } = await sensitive(canvasElement)
  await userEvent.click(submit)
  await dialog.findByRole("alert")
  await expect(purpose).toHaveValue("Investigate the user's support request")
  await expect(submit).toBeEnabled()
  await expect(dialog.queryByText(platformUserFullEmail)).toBeNull()
  await userEvent.click(submit)
  await dialog.findByText(platformUserFullEmail)
  await userEvent.click(dialog.getByRole("button", { name: "Close" }))
  await closed(screen)
}
export const SensitiveFailure: Story = {
  args: { detail: true },
  ...scenario("sensitiveFailure"),
  play: sensitiveRetry,
}
export const SensitiveRateLimited: Story = {
  args: { detail: true },
  ...scenario("sensitiveRateLimited"),
  play: sensitiveRetry,
}
export const SensitiveRTL: Story = {
  args: { detail: true },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "عرض البريد الإلكتروني الكامل",
      })
    )
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(
      dialog.getByRole("textbox", { name: "غرض الوصول" }),
      "مراجعة طلب الدعم الخاص بالمستخدم"
    )
    dialog.getByRole("button", { name: "عرض البريد الإلكتروني الكامل" }).focus()
    await userEvent.keyboard("{Enter}")
    await dialog.findByText(platformUserFullEmail)
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await userEvent.click(dialog.getByRole("button", { name: "إغلاق" }))
    await closed(screen)
    await expect(canvas.queryByText(platformUserFullEmail)).toBeNull()
  },
}
export const FilterAndPagination: Story = {
  ...scenario("paginated"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(canvas.getAllByRole("row")).toHaveLength(21)
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await canvas.findByRole("link", { name: "Directory member 25" })
    await userEvent.type(
      canvas.getByRole("textbox", {
        name: "Search name, user ID or masked email",
      }),
      "Mina"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByRole("link", { name: platformUserFixture.name })
    await expect(canvas.getAllByRole("row")).toHaveLength(2)
    await expect(
      canvas.queryByRole("link", { name: "Directory member 25" })
    ).toBeNull()
  },
}
