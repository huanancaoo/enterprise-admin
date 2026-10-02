import { useState } from "react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test"
import { AuditEventsQuerySchema } from "@workspace/contracts"
import {
  createOrganizationAuditScenario,
  organizationAuditFixture,
  organizationAuditSummary,
  organizations,
  type OrganizationAuditScenario,
} from "@workspace/mocks"
import { AuditEventsRoute } from "./audit-events-route"

function AuditStory() {
  const [router] = useState(() => {
    const root = createRootRoute({
      component: () => (
        <main className="mx-auto max-w-6xl p-6">
          <Outlet />
        </main>
      ),
    })
    const audit = createRoute({
      getParentRoute: () => root,
      path: "/app/organizations/$organizationId/audit",
      validateSearch: (search) => AuditEventsQuerySchema.parse(search),
      component: AuditEventsRoute,
    })
    return createRouter({
      routeTree: root.addChildren([audit]),
      history: createMemoryHistory({
        initialEntries: [
          "/app/organizations/" + organizations[0].id + "/audit",
        ],
      }),
    })
  })
  // 只运行审计 Feature：内容查询、筛选和弹层使用正式组件，身份与隔离由真实链路验收。
  return <RouterProvider router={router} />
}
const scenario = (name: OrganizationAuditScenario = "success") => {
  const fixture = createOrganizationAuditScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
  }
}
const meta = {
  title: "Admin/Organization audit",
  component: AuditStory,
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof AuditStory>
export default meta
type Story = StoryObj<typeof meta>

const error: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.getByRole("button", { name: "Retry" })).toBeVisible()
  await expect(canvas.queryByRole("table")).toBeNull()
}
async function detail(canvasElement: HTMLElement, name = "Project updated") {
  const canvas = within(canvasElement)
  await canvas.findByRole("table")
  const trigger = canvas.getAllByRole("button", { name })[0]
  await userEvent.click(trigger)
  const screen = within(canvasElement.ownerDocument.body)
  const popup = await screen.findByRole("dialog")
  await waitFor(() => expect(popup).toBeVisible())
  return { canvas, screen, popup, dialog: within(popup), trigger }
}
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    const trigger = canvas.getAllByRole("button", {
      name: "Project updated",
    })[0]
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    await dialog.findByText("changedFields")
    await expect(dialog.getByText('["name"]')).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await expect(trigger).toHaveFocus()
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveTextContent("Loading audit records…")
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("No audit records found for this date range.")
    await expect(canvas.queryByRole("table")).toBeNull()
  },
}
export const Error: Story = { ...scenario("unavailable"), play: error }
export const PermissionDenied: Story = { ...scenario("forbidden"), play: error }
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: error,
}
export const RateLimited: Story = { ...scenario("rateLimited"), play: error }
export const RetryRestoresRecords: Story = {
  ...scenario("retryable"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("alert")
    await userEvent.click(canvas.getByRole("button", { name: "Retry" }))
    await canvas.findByRole("table")
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(
      "international-research-project-".repeat(4)
    )
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
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
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(canvas.getByRole("heading", { name: "审计" })).toBeVisible()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("status")
    await canvas.findByRole("table")
  },
}
export const Detail: Story = {
  play: async ({ canvasElement }) => {
    await (
      await detail(canvasElement)
    ).dialog.findByText(organizationAuditFixture.resourceId!)
  },
}
export const DetailLoading: Story = {
  ...scenario("detailLoading"),
  play: async ({ canvasElement }) => {
    await expect(
      await (await detail(canvasElement)).dialog.findByRole("status")
    ).toHaveTextContent("Loading audit records…")
  },
}
const detailError: Story["play"] = async ({ canvasElement }) => {
  const { dialog } = await detail(canvasElement)
  await dialog.findByRole("alert")
  await expect(dialog.queryByText("changedFields")).toBeNull()
}
export const DetailError: Story = {
  ...scenario("detailError"),
  play: detailError,
}
export const DetailNotFound: Story = {
  ...scenario("detailNotFound"),
  play: detailError,
}
export const DetailPermissionDenied: Story = {
  ...scenario("detailForbidden"),
  play: detailError,
}
export const DetailSessionExpired: Story = {
  ...scenario("detailUnauthorized"),
  play: detailError,
}
export const DetailLongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    const { dialog, popup } = await detail(canvasElement)
    await dialog.findByText("国际研发与合规协作记录 ".repeat(60).trim())
    await Promise.all(
      popup.getAnimations().map((animation) => animation.finished)
    )
    const rect = popup.getBoundingClientRect()
    await expect(rect.top).toBeGreaterThanOrEqual(0)
    await expect(rect.bottom).toBeLessThanOrEqual(
      canvasElement.ownerDocument.defaultView!.innerHeight
    )
  },
}
export const DetailRTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const { dialog } = await detail(canvasElement, "تحديث مشروع")
    await dialog.findByText("changedFields")
    await expect(dialog.getByRole("button", { name: "إغلاق" })).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const PlatformProjection: Story = {
  play: async ({ canvasElement }) => {
    const { dialog } = await detail(
      canvasElement,
      "Organization suspended by platform"
    )
    await dialog.findByText(organizationAuditSummary)
    await expect(dialog.queryByText("changedFields")).toBeNull()
  },
}
export const SystemActor: Story = {
  ...scenario("systemActor"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("System")
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
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Resource type" }),
      "organization"
    )
    await userEvent.selectOptions(
      canvas.getByRole("combobox", { name: "Result" }),
      "succeeded"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByRole("button", {
      name: "Organization suspended by platform",
    })
    await expect(canvas.getAllByRole("row")).toHaveLength(2)
    await expect(canvas.queryByRole("button", { name: "Next page" })).toBeNull()
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(21))
    await expect(
      canvas.getByRole("textbox", { name: "Resource type" })
    ).toHaveValue("")
  },
}
export const InvalidActor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Actor ID" }),
      "invalid-id"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText("Enter a valid UUID.")
    await expect(canvas.getByRole("textbox", { name: "Actor ID" })).toHaveValue(
      "invalid-id"
    )
    await expect(canvas.getAllByRole("row")).toHaveLength(3)
  },
}
export const ReversedDateRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    fireEvent.change(canvas.getByLabelText("From date"), {
      target: { value: "2026-10-02" },
    })
    fireEvent.change(canvas.getByLabelText("To date"), {
      target: { value: "2026-10-01" },
    })
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText("The start date must not be after the end date.")
    await expect(canvas.getAllByRole("row")).toHaveLength(3)
  },
}
export const RangeTooLong: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    fireEvent.change(canvas.getByLabelText("From date"), {
      target: { value: "2026-01-01" },
    })
    fireEvent.change(canvas.getByLabelText("To date"), {
      target: { value: "2026-10-01" },
    })
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await canvas.findByText("The date range cannot exceed 90 days.")
    await expect(canvas.getAllByRole("row")).toHaveLength(3)
  },
}
