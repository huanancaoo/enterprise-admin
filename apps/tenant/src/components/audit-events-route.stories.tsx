import { useState } from "react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
  useSearch,
} from "@tanstack/react-router"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test"
import { AuditEventsQuerySchema } from "@workspace/contracts/audit"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import {
  createOrganizationAuditScenario,
  createOrganizationAuditControlsScenario,
  organizationAuditUser,
  organizationAuditExportTask,
  organizationAuditFixture,
  organizationAuditSummary,
  organizations,
  type OrganizationAuditScenario,
} from "@workspace/mocks"
import { AuditEventsRoute } from "./audit-events-route"

const authClient = createWorkspaceAuthClient()

function TaskCenterTarget() {
  const search = useSearch({ strict: false })
  const params = useParams({ strict: false })
  // 任务中心载体只输出跳转参数供断言，不属于产品文案。
  // i18next-instrument-ignore
  return (
    <section>
      <h1>Task center</h1>
      <output aria-label="Task center destination">
        {JSON.stringify({ ...params, ...search })}
      </output>
    </section>
  )
}

function AuditStory({ initialSearch = "" }: { initialSearch?: string }) {
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
    const tasks = createRoute({
      getParentRoute: () => root,
      path: "/app/tasks/$organizationId",
      validateSearch: (search) => search,
      component: TaskCenterTarget,
    })
    return createRouter({
      routeTree: root.addChildren([audit, tasks]),
      history: createMemoryHistory({
        initialEntries: [
          "/app/organizations/" +
            organizations[0].id +
            "/audit" +
            initialSearch,
        ],
      }),
    })
  })
  // 只运行审计 Feature：内容查询、筛选和弹层使用正式组件，身份与隔离由真实链路验收。
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={organizationAuditUser}
    >
      <RouterProvider router={router} />
    </AuthenticatedSessionProvider>
  )
}
function composeScenario(
  fixture: ReturnType<typeof createOrganizationAuditScenario>,
  controls = createOrganizationAuditControlsScenario()
) {
  return {
    beforeEach: () => {
      fixture.reset()
      controls.reset()
    },
    parameters: {
      layout: "fullscreen",
      msw: { handlers: [...fixture.handlers, ...controls.handlers] },
    },
  }
}
const scenario = (name: OrganizationAuditScenario = "success") =>
  composeScenario(createOrganizationAuditScenario(name))
const meta = {
  title: "Admin/Organization operation logs",
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
  await expect(
    canvas.queryByRole("button", { name: "Project updated" })
  ).toBeNull()
}
async function detail(canvasElement: HTMLElement, name = "Project updated") {
  const canvas = within(canvasElement)
  const trigger = (await canvas.findAllByRole("button", { name }))[0]
  await userEvent.click(trigger)
  const screen = within(canvasElement.ownerDocument.body)
  const popup = await screen.findByRole("dialog")
  await waitFor(() => expect(popup).toBeVisible())
  return { canvas, screen, popup, dialog: within(popup), trigger }
}
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = (
      await canvas.findAllByRole("button", {
        name: "Project updated",
      })
    )[0]
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    const screen = within(canvasElement.ownerDocument.body)
    const popup = await screen.findByRole("dialog")
    await waitFor(() => expect(popup).toBeVisible())
    await Promise.all(
      popup.getAnimations().map((animation) => animation.finished)
    )
    const dialog = within(popup)
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
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="data-table"]')
      ).toHaveAttribute("aria-busy", "true")
    )
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("No data yet")
    await expect(canvas.getByLabelText("From date")).toBeVisible()
  },
}
export const Error: Story = { ...scenario("unavailable"), play: error }
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Access denied")
    await expect(
      canvas.queryByRole("button", { name: "Project updated" })
    ).toBeNull()
  },
}
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
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await expect(
      canvas.getByRole("heading", { name: "操作日志" })
    ).toBeVisible()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="data-table"]')
      ).toHaveAttribute("aria-busy", "true")
    )
    await canvas.findAllByRole("button", { name: "Project updated" })
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
    ).toHaveTextContent("Loading operation logs…")
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
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findAllByRole("button", { name: "Project updated" })
    await expect(canvas.getAllByRole("row")).toHaveLength(21)
    await userEvent.click(canvas.getByRole("button", { name: "View" }))
    await userEvent.click(
      await screen.findByRole("checkbox", { name: "Show Resource type" })
    )
    await userEvent.keyboard("{Escape}")
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(canvas.getAllByRole("row")).toHaveLength(6))
    await expect(
      canvas.queryByRole("columnheader", { name: "Resource type" })
    ).toBeNull()
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search by event code" }),
      "platform.organization_suspended"
    )
    await userEvent.click(canvas.getByRole("button", { name: "Search" }))
    await canvas.findByRole("button", {
      name: "Organization suspended by platform",
    })
    await expect(canvas.getAllByRole("row")).toHaveLength(2)
    await expect(
      canvas.getByRole("button", { name: "Next page" })
    ).toHaveAttribute("aria-disabled", "true")
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }))
    await canvas.findAllByRole("button", { name: "Project updated" })
    await expect(canvas.getAllByRole("row")).toHaveLength(21)
    await userEvent.click(canvas.getByRole("button", { name: "Result" }))
    await userEvent.click(
      await screen.findByRole("option", { name: "Succeeded" })
    )
    await userEvent.keyboard("{Escape}")
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Resource type" }),
      "project"
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await canvas.findAllByRole("button", { name: "Project updated" })
    await expect(
      canvas.queryByRole("button", {
        name: "Organization suspended by platform",
      })
    ).toBeNull()
    await expect(canvas.getByText("24 rows")).toBeVisible()
    await expect(
      canvas.queryByRole("columnheader", { name: "Resource type" })
    ).toBeNull()
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }))
    await waitFor(() => expect(canvas.getByText("25 rows")).toBeVisible())
  },
}
export const InvalidResourceId: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole("button", { name: "Project updated" })
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.type(
      screen.getByRole("textbox", { name: "Resource ID" }),
      "invalid-id"
    )
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await screen.findByText("Enter a valid UUID.")
    await expect(
      screen.getByRole("textbox", { name: "Resource ID" })
    ).toHaveValue("invalid-id")
    await expect(canvas.getAllByRole("row")).toHaveLength(3)
  },
}
export const ReversedDateRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole("button", { name: "Project updated" })
    const screen = within(canvasElement.ownerDocument.body)
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-10-02" },
    })
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-10-01" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await screen.findByText("The start date must not be after the end date.")
    await expect(canvas.getAllByRole("row")).toHaveLength(3)
  },
}
export const RangeTooLong: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole("button", { name: "Project updated" })
    const screen = within(canvasElement.ownerDocument.body)
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-01-01" },
    })
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2026-10-01" },
    })
    await userEvent.click(screen.getByRole("button", { name: "Apply filters" }))
    await screen.findByText("The date range cannot exceed 90 days.")
    await expect(canvas.getAllByRole("row")).toHaveLength(3)
  },
}

export const RevokedDetailClearsCachedContent: Story = {
  ...scenario("detailRevoked"),
  play: async ({ canvasElement }) => {
    const { dialog, screen, trigger } = await detail(canvasElement)
    await dialog.findByText(organizationAuditFixture.resourceId!)
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await userEvent.click(trigger)
    const revoked = within(await screen.findByRole("dialog"))
    await revoked.findByRole("alert")
    await expect(
      revoked.queryByText(organizationAuditFixture.resourceId!)
    ).toBeNull()
    await expect(revoked.queryByText("changedFields")).toBeNull()
  },
}

const preciseTo = new Date().toISOString().replace("Z", "123Z")
const preciseFrom = new Date(Date.parse(preciseTo) - 90 * 86400000)
  .toISOString()
  .replace("Z", "123Z")
const preciseAudit = createOrganizationAuditScenario()
export const PreserveExactWindowWhenApplyingFilters: Story = {
  ...composeScenario(preciseAudit),
  args: {
    initialSearch: `?from=${encodeURIComponent(preciseFrom)}&to=${encodeURIComponent(preciseTo)}`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findAllByRole("button", { name: "Project updated" })
    await userEvent.click(
      await screen.findByRole("button", { name: "Apply filters" })
    )
    await expect(
      canvas.getByRole("button", { name: "Apply filters" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Project updated" })
    ).toBeVisible()
    await expect(preciseAudit.requests().at(-1)).toMatchObject({
      from: preciseFrom,
      to: preciseTo,
    })
  },
}

const actorFilterAudit = createOrganizationAuditScenario()
const actorFilterControls = createOrganizationAuditControlsScenario()
export const FilterByCurrentMember: Story = {
  ...composeScenario(actorFilterAudit, actorFilterControls),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findAllByRole("button", { name: "Project updated" })
    await expect(
      canvas.queryByRole("button", { name: /Advanced filters/ })
    ).toBeNull()
    await userEvent.click(canvas.getByRole("combobox", { name: "Actor" }))
    await userEvent.click(
      await screen.findByRole("option", {
        name: "Morgan Audit",
      })
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await waitFor(() => expect(canvas.getByText("1 rows")).toBeVisible())
    await expect(actorFilterAudit.requests().at(-1)).toMatchObject({
      actorId: organizationAuditUser.id,
      page: 1,
    })
    await expect(
      actorFilterControls
        .memberRequests()
        .every((request) => request.organizationId === organizations[0].id)
    ).toBe(true)
    await expect(
      canvas.queryByRole("button", {
        name: "Organization suspended by platform",
      })
    ).toBeNull()
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear selection" })
    )
    await userEvent.click(canvas.getByRole("button", { name: "Apply filters" }))
    await waitFor(() => expect(canvas.getByText("2 rows")).toBeVisible())
    await expect(actorFilterAudit.requests().at(-1)?.actorId).toBeUndefined()
  },
}

const memberDeniedControls = createOrganizationAuditControlsScenario({
  members: "forbidden",
})
export const MemberLookupDeniedKeepsLogsReadable: Story = {
  ...composeScenario(createOrganizationAuditScenario(), memberDeniedControls),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findAllByRole("button", { name: "Project updated" })
    await userEvent.click(canvas.getByRole("combobox", { name: "Actor" }))
    await screen.findByText("Could not load members. Please retry.")
    await expect(screen.queryByRole("option")).toBeNull()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await expect(
      canvas.getByRole("button", { name: "Project updated" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("button", { name: "Apply filters" })
    ).toBeVisible()
  },
}

const exportWindow = { from: preciseFrom, to: preciseTo }
const exportAudit = createOrganizationAuditScenario("success", {
  window: exportWindow,
})
const exportControls = createOrganizationAuditControlsScenario({
  canExport: true,
})
const matchingExportFilter = {
  eventCode: "project.updated",
  actorId: organizationAuditUser.id,
  resourceType: "project",
  resourceId: organizationAuditFixture.resourceId!,
  result: "succeeded",
}
export const ExportMatchingWindowToTaskCenter: Story = {
  ...composeScenario(exportAudit, exportControls),
  args: {
    initialSearch: `?${new URLSearchParams({ page: "1", pageSize: "20", ...matchingExportFilter })}`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("button", { name: "Project updated" })
    const button = await canvas.findByRole("button", {
      name: "Export matching results",
    })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await canvas.findByRole("heading", { name: "Task center" })
    await expect(exportControls.exportRequests()).toHaveLength(1)
    await expect(exportControls.exportRequests()[0]).toEqual({
      organizationId: organizations[0].id,
      body: {
        format: "xlsx",
        filter: { ...matchingExportFilter, ...exportWindow },
      },
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    })
    await expect(
      JSON.parse(canvas.getByLabelText("Task center destination").textContent!)
    ).toEqual({
      organizationId: organizations[0].id,
      page: 1,
      pageSize: 20,
      source: "business",
      taskId: organizationAuditExportTask.id,
    })
  },
}

const loadingExportControls = createOrganizationAuditControlsScenario({
  canExport: true,
})
export const ExportDisabledUntilWindowIsKnown: Story = {
  ...composeScenario(
    createOrganizationAuditScenario("loading"),
    loadingExportControls
  ),
  play: async ({ canvasElement }) => {
    const button = await within(canvasElement).findByRole("button", {
      name: "Export matching results",
    })
    await expect(button).toBeDisabled()
    await expect(loadingExportControls.exportRequests()).toHaveLength(0)
  },
}
export const AuditReadDoesNotGrantExport: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole("button", { name: "Project updated" })
    await expect(
      canvas.queryByRole("button", { name: "Export matching results" })
    ).toBeNull()
  },
}
const revokedExportControls = createOrganizationAuditControlsScenario({
  canExport: true,
})
export const ExportRevokedBeforeSubmission: Story = {
  ...composeScenario(createOrganizationAuditScenario(), revokedExportControls),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole("button", { name: "Project updated" })
    const button = await canvas.findByRole("button", {
      name: "Export matching results",
    })
    await waitFor(() => expect(button).toBeEnabled())
    revokedExportControls.revoke()
    await userEvent.click(button)
    await canvas.findByRole("alert")
    await expect(
      canvas.queryByRole("heading", { name: "Task center" })
    ).toBeNull()
    await expect(
      canvas.getByRole("button", { name: "Project updated" })
    ).toBeVisible()
  },
}
const retryExportControls = createOrganizationAuditControlsScenario({
  canExport: true,
  export: "retryable",
})
export const RetryUnknownExportKeepsIdempotencyKey: Story = {
  ...composeScenario(createOrganizationAuditScenario(), retryExportControls),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findAllByRole("button", { name: "Project updated" })
    const button = await canvas.findByRole("button", {
      name: "Export matching results",
    })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    await canvas.findByRole("alert")
    await userEvent.click(button)
    await canvas.findByRole("heading", { name: "Task center" })
    const requests = retryExportControls.exportRequests()
    await expect(requests).toHaveLength(2)
    await expect(requests[1].body).toEqual(requests[0].body)
    await expect(requests[1].idempotencyKey).toBe(requests[0].idempotencyKey)
  },
}
