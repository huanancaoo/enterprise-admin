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
  title: "Platform/Audit",
  component: PlatformReadPageStory,
  args: { page: "audit" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof PlatformReadPageStory>
export default meta
type Story = StoryObj<typeof meta>
const localeLabels = {
  en: {
    purpose: "Purpose of access",
    apply: "Apply filters",
    details: "Audit details",
  },
  zh: { purpose: "读取目的", apply: "应用筛选", details: "审计详情" },
  ar: {
    purpose: "غرض الوصول",
    apply: "تطبيق عوامل التصفية",
    details: "تفاصيل التدقيق",
  },
}
async function apply(
  canvasElement: HTMLElement,
  locale: keyof typeof localeLabels = "en"
) {
  const canvas = within(canvasElement)
  const purpose = await canvas.findByRole("textbox", {
    name: localeLabels[locale].purpose,
  })
  await userEvent.type(
    purpose,
    locale === "ar" ? "مراجعة تشغيل المنظمات" : "Review organization operations"
  )
  await userEvent.click(
    canvas.getByRole("button", { name: localeLabels[locale].apply })
  )
  return canvas
}
async function details(
  canvasElement: HTMLElement,
  locale: keyof typeof localeLabels = "en"
) {
  const canvas = await apply(canvasElement, locale)
  await canvas.findByRole("table")
  await userEvent.click(
    canvas.getAllByRole("button", { name: localeLabels[locale].details })[0]
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
  const canvas = await apply(canvasElement)
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
      canvas.getAllByRole("button", { name: "Audit details" })[0]
    ).toHaveFocus()
  },
}
export const BeforeInvestigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(
      "Enter a purpose and apply filters to load audit records."
    )
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await expect(await canvas.findByRole("status")).toHaveAttribute(
      "aria-busy",
      "true"
    )
    await expect(
      canvas.getByRole("textbox", { name: "Purpose of access" })
    ).toBeDisabled()
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await canvas.findByRole("heading", { name: "No results" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const Error: Story = { ...scenario("unavailable"), play: errorPlay }
export const RetryRestoresRecords: Story = {
  ...scenario("retryable"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await canvas.findByRole("alert")
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await canvas.findByText(platformAuditFixture.eventCode)
    await expect(
      canvas.getByRole("textbox", { name: "Purpose of access" })
    ).toHaveValue("Review organization operations")
  },
}
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await canvas.findByRole("heading", { name: "Platform access denied" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await canvas.findByRole("heading", { name: "Sign in" })
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await (await apply(canvasElement)).findByText(/国际研发与合规协作组织/)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement, "ar")
    await canvas.findByRole("table")
    await expect(
      canvas.getByRole("heading", { name: "سجل التدقيق" })
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
    const canvas = await apply(canvasElement, "zh")
    await canvas.findByRole("table")
    await expect(canvas.getByRole("heading", { name: "审计" })).toBeVisible()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await expect(await canvas.findByRole("status")).toHaveAttribute(
      "aria-busy",
      "true"
    )
    await canvas.findByRole("table")
  },
}
export const ReadOnly: Story = {
  args: { auditor: true },
  play: async ({ canvasElement }) => {
    await (await apply(canvasElement)).findByRole("table")
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
    const canvas = await apply(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      canvas.getAllByRole("button", { name: "Audit details" })[0]
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
    const canvas = await apply(canvasElement)
    await canvas.findByRole("table")
    await userEvent.click(
      canvas.getAllByRole("button", { name: "Audit details" })[0]
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
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Purpose of access" }),
      "   "
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText("Enter a purpose between 1 and 500 characters.")
    await expect(canvas.queryByRole("table")).toBeNull()
    await userEvent.clear(
      canvas.getByRole("textbox", { name: "Purpose of access" })
    )
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Purpose of access" }),
      "Review organization operations"
    )
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Organization ID" }),
      "invalid-id"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText(
      "Enter a valid value and a date range of at most 90 days ending no later than now."
    )
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const FutureDateRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "Purpose of access" }),
      "Review organization operations"
    )
    fireEvent.change(canvas.getByLabelText("From (UTC)"), {
      target: { value: "2099-01-01T00:00" },
    })
    fireEvent.change(canvas.getByLabelText("To (UTC)"), {
      target: { value: "2099-01-02T00:00" },
    })
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText(
      "Enter a valid value and a date range of at most 90 days ending no later than now."
    )
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const FilterAndPagination: Story = {
  ...scenario("paginated"),
  play: async ({ canvasElement }) => {
    const canvas = await apply(canvasElement)
    await canvas.findByRole("table")
    await expect(canvas.getAllByRole("row")).toHaveLength(21)
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toBeDisabled()
    await userEvent.click(canvas.getByRole("button", { name: "Previous page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    const organizationId = canvas.getByRole("textbox", {
      name: "Organization ID",
    })
    // 上一页缓存行会先出现；筛选要等当前读回结束后才恢复可编辑。
    await waitFor(() => expect(organizationId).toBeEnabled())
    await userEvent.type(organizationId, "c7dd0a27-4f8a-4aef-8d4c-000000000002")
    await userEvent.click(canvas.getByRole("combobox", { name: "Result" }))
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(await screen.findByRole("option", { name: "Denied" }))
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText("member.role_changed")
    await expect(canvas.getAllByRole("row")).toHaveLength(2)
    await expect(canvas.queryByText(platformAuditFixture.eventCode)).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "Previous page" })
    ).toBeDisabled()
    // URL 筛选条件变化会重建表单，重置时需要取得当前输入框。
    const resetOrganizationId = canvas.getByRole("textbox", {
      name: "Organization ID",
    })
    await waitFor(() => expect(resetOrganizationId).toBeEnabled())
    await userEvent.click(canvas.getByRole("combobox", { name: "Result" }))
    await userEvent.click(
      await screen.findByRole("option", { name: "Any result" })
    )
    await userEvent.clear(resetOrganizationId)
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
  },
}
