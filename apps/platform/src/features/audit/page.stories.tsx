import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test"
import {
  createPlatformAuditScenario,
  createWorkspaceSessionHandlers,
  platformAuditFixture,
  type PlatformAuditScenario,
} from "@workspace/mocks"
import { PlatformReadPageStory } from "../platform-read-page.story-fixture"

const scenario = (name: PlatformAuditScenario = "success") => {
  const fixture = createPlatformAuditScenario(name)
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
  title: "Platform/Operation logs",
  component: PlatformReadPageStory,
  args: { page: "audit" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof PlatformReadPageStory>
export default meta
type Story = StoryObj<typeof meta>
const localeLabels = {
  en: { filters: "Filters", details: "Operation log details" },
  zh: { filters: "筛选条件", details: "操作日志详情" },
  ar: { filters: "عوامل التصفية", details: "تفاصيل سجل العمليات" },
}
async function load(canvasElement: HTMLElement) {
  return within(canvasElement)
}
async function filters(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const trigger = await canvas.findByRole("button", {
    name: /^Advanced filters/,
  })
  await waitFor(() => expect(trigger).toBeEnabled())
  await userEvent.click(trigger)
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog", {
      name: "Advanced filters",
    })
  )
}
async function details(
  canvasElement: HTMLElement,
  locale: keyof typeof localeLabels = "en"
) {
  const canvas = await load(canvasElement)
  await canvas.findByRole("table")
  await userEvent.click(
    (
      await canvas.findAllByRole("button", {
        name: localeLabels[locale].details,
      })
    )[0]
  )
  const screen = within(canvasElement.ownerDocument.body)
  const popup = await screen.findByRole("dialog")
  await waitFor(() => expect(popup).toBeVisible())
  const dialog = within(popup)
  return { canvas, screen, dialog }
}
async function closed(screen: ReturnType<typeof within>) {
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { hidden: true })
    ).not.toBeInTheDocument()
  )
}
const errorPlay: Story["play"] = async ({ canvasElement }) => {
  const canvas = await load(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible()
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, screen, dialog } = await details(canvasElement)
    await dialog.findByText(platformAuditFixture.id)
    await expect(dialog.getByText(platformAuditFixture.eventCode)).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await closed(screen)
    await expect(
      (
        await canvas.findAllByRole("button", { name: "Operation log details" })
      )[0]
    ).toHaveFocus()
  },
}
export const StandardToolbar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Operation logs" })
    await expect(
      canvas.getByRole("textbox", { name: "Event code (exact match)" })
    ).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Search" })).toBeVisible()
    await expect(canvas.getByRole("button", { name: "Result" })).toBeVisible()
    const panel = await filters(canvasElement)
    await expect(panel.queryByLabelText(/Purpose/)).toBeNull()
    await expect(panel.getAllByRole("textbox")).toHaveLength(2)
    const org = panel.getByRole("textbox", { name: "Organization ID" })
    await userEvent.type(org, "c7dd0a27-4f8a-4aef-8d4c-000000000002")
    await userEvent.keyboard("{Escape}")
    const reopened = await filters(canvasElement)
    await expect(
      reopened.getByRole("textbox", { name: "Organization ID" })
    ).toHaveValue("c7dd0a27-4f8a-4aef-8d4c-000000000002")
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await expect(
      canvasElement.querySelector('[data-slot="data-table"]')
    ).toHaveAttribute("aria-busy", "true")
    await expect(
      canvas.getByRole("button", { name: /^Advanced filters/ })
    ).toBeDisabled()
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByText("No data yet")
    await expect(canvas.queryByRole("table")).toBeNull()
    const panel = await filters(canvasElement)
    await expect(
      panel.getByRole("textbox", { name: "Organization ID" })
    ).toBeEnabled()
  },
}
export const Error: Story = { ...scenario("unavailable"), play: errorPlay }
export const RetryRestoresRecords: Story = {
  ...scenario("retryable"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("alert")
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await canvas.findByText(platformAuditFixture.eventCode)
    const panel = await filters(canvasElement)
    await expect(
      panel.getByRole("textbox", { name: "Organization ID" })
    ).toHaveValue("")
  },
}
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("heading", { name: "Sign in" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await (await load(canvasElement)).findByText(/国际研发与合规协作组织/)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("table")
    await expect(
      canvas.getByRole("heading", { name: "سجل العمليات" })
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
    const canvas = await load(canvasElement)
    await canvas.findByRole("table")
    await expect(
      canvas.getByRole("heading", { name: "操作日志" })
    ).toBeVisible()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await expect(
      canvasElement.querySelector('[data-slot="data-table"]')
    ).toHaveAttribute("aria-busy", "true")
    await canvas.findByRole("table")
  },
}
export const ReadOnly: Story = {
  args: { auditor: true },
  play: async ({ canvasElement }) => {
    await (await load(canvasElement)).findByRole("table")
  },
}
export const Detail: Story = {
  play: async ({ canvasElement }) => {
    await (
      await details(canvasElement)
    ).dialog.findByText(platformAuditFixture.id)
  },
}
export const DetailLoading: Story = {
  ...scenario("detailLoading"),
  play: async ({ canvasElement }) => {
    await expect(
      await (await details(canvasElement)).dialog.findByRole("status")
    ).toHaveAttribute("aria-busy", "true")
  },
}
export const DetailError: Story = {
  ...scenario("detailError"),
  play: async ({ canvasElement }) => {
    const { dialog } = await details(canvasElement)
    await dialog.findByRole("alert")
    await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible()
  },
}
export const DetailNotFound: Story = {
  ...scenario("detailNotFound"),
  play: async ({ canvasElement }) => {
    await (
      await details(canvasElement)
    ).dialog.findByRole("heading", { name: "Page not found" })
  },
}
export const DetailPermissionDenied: Story = {
  ...scenario("detailForbidden"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      (
        await canvas.findAllByRole("button", { name: "Operation log details" })
      )[0]
    )
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await closed(screen)
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const DetailSessionExpired: Story = {
  ...scenario("detailUnauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      (
        await canvas.findAllByRole("button", { name: "Operation log details" })
      )[0]
    )
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findByRole("heading", { name: "Sign in" })
    await closed(screen)
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const DetailLongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await (
      await details(canvasElement)
    ).dialog.findByText(/国际研发与合规协作组织/)
  },
}
export const DetailRTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await (
      await details(canvasElement, "ar")
    ).dialog.findByText(platformAuditFixture.id)
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const RoleChange: Story = {
  ...scenario("roleChange"),
  play: async ({ canvasElement }) => {
    await (
      await details(canvasElement)
    ).dialog.findByText("— → platform_auditor")
  },
}
export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    const panel = await filters(canvasElement)
    await userEvent.type(
      panel.getByRole("textbox", { name: "Organization ID" }),
      "invalid-id"
    )
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await panel.findByText(
      "Enter a valid value and a date range of at most 90 days ending no later than now."
    )
    await expect(canvas.getByRole("table")).toBeVisible()
  },
}
export const FutureDateRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    const panel = await filters(canvasElement)
    fireEvent.change(panel.getByLabelText("From (UTC)"), {
      target: { value: "2099-01-01T00:00" },
    })
    fireEvent.change(panel.getByLabelText("To (UTC)"), {
      target: { value: "2099-01-02T00:00" },
    })
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await panel.findByText(
      "Enter a valid value and a date range of at most 90 days ending no later than now."
    )
    await expect(canvas.getByRole("table")).toBeVisible()
  },
}
export const FilterAndPagination: Story = {
  ...scenario("paginated"),
  play: async ({ canvasElement }) => {
    const canvas = await load(canvasElement)
    await canvas.findByRole("table")
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(canvas.getByRole("button", { name: "Previous page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    const panel = await filters(canvasElement)
    const organizationId = panel.getByRole("textbox", {
      name: "Organization ID",
    })
    // 上一页缓存行会先出现；筛选要等当前读回结束后才恢复可编辑。
    await waitFor(() => expect(organizationId).toBeEnabled())
    await userEvent.type(organizationId, "c7dd0a27-4f8a-4aef-8d4c-000000000002")
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText("member.role_changed")
    await userEvent.click(canvas.getByRole("button", { name: "Result" }))
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(await screen.findByRole("option", { name: "Denied" }))
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(2))
    await expect(canvas.queryByText(platformAuditFixture.eventCode)).toBeNull()
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Event code (exact match)" }),
      "member.role_changed"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Search" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(2))
    await expect(
      canvas.getByRole("textbox", { name: "Event code (exact match)" })
    ).toHaveValue("member.role_changed")
  },
}
