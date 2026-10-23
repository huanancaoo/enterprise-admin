import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import {
  PlatformScheduleQuerySchema,
  PlatformScheduleRunsQuerySchema,
} from "@workspace/contracts/platform-schedules"
import {
  createScheduleScenario,
  createWorkspaceSessionHandlers,
  platformOrganizationActor,
  scheduleFixtureId,
  scheduleFixture,
  type ScheduleScenario,
} from "@workspace/mocks"
import { authClient } from "../../lib/auth-client"
import { PlatformSchedulesPage, PlatformScheduleRunsPage } from "./pages"
import { PlatformPermission } from "../system/permission"

function SchedulesStory({
  readOnly = false,
  showRuns = false,
  monitorAccess = true,
}: {
  readOnly?: boolean
  showRuns?: boolean
  monitorAccess?: boolean
}) {
  const [router] = useState(() => {
    const root = createRootRoute()
    const platform = createRoute({
      getParentRoute: () => root,
      path: "platform",
      beforeLoad: () => ({
        platformAccess: {
          userId: platformOrganizationActor.id,
          roles: [],
          permissions: [
            "platform.schedule:read",
            ...(readOnly
              ? []
              : ["platform.schedule:manage", "platform.schedule:run"]),
            ...(monitorAccess ? ["platform.monitor:read"] : []),
          ],
          scope: "global",
          mfaVerifiedAt: null,
        },
      }),
      component: Outlet,
    })
    const schedules = createRoute({
      getParentRoute: () => platform,
      path: "schedules",
      validateSearch: (search) => PlatformScheduleQuerySchema.parse(search),
      component: PlatformSchedulesPage,
    })
    const runs = createRoute({
      getParentRoute: () => platform,
      path: "schedules/$scheduleId/runs",
      validateSearch: (search) => PlatformScheduleRunsQuerySchema.parse(search),
      component: () => (
        <PlatformPermission action="platform.monitor:read">
          <PlatformScheduleRunsPage />
        </PlatformPermission>
      ),
    })
    return createRouter({
      routeTree: root.addChildren([platform.addChildren([schedules, runs])]),
      history: createMemoryHistory({
        initialEntries: [
          showRuns
            ? `/platform/schedules/${scheduleFixtureId}/runs`
            : "/platform/schedules",
        ],
      }),
    })
  })
  return (
    <AuthenticatedSessionProvider
      client={authClient}
      user={platformOrganizationActor}
    >
      <main className="mx-auto max-w-6xl p-4">
        <RouterProvider router={router} />
      </main>
    </AuthenticatedSessionProvider>
  )
}
function scenario(name: ScheduleScenario = "success") {
  const fixture = createScheduleScenario(name)
  return {
    fixture,
    story: {
      beforeEach: fixture.reset,
      parameters: {
        layout: "fullscreen",
        msw: {
          handlers: [...fixture.handlers, ...createWorkspaceSessionHandlers()],
        },
      },
    },
  }
}
const defaults = scenario()
const meta = {
  title: "Platform/Scheduled tasks",
  component: SchedulesStory,
  globals: { locale: "en-US" },
  ...defaults.story,
} satisfies Meta<typeof SchedulesStory>
export default meta
type Story = StoryObj<typeof meta>
async function table(canvasElement: HTMLElement) {
  const node = await within(canvasElement).findByRole("table")
  await waitFor(() => expect(node).toHaveAttribute("aria-busy", "false"))
  return node
}
async function firstRow(canvasElement: HTMLElement) {
  await table(canvasElement)
  return within(
    (await within(canvasElement).findByText("Service health")).closest("tr")!
  )
}
async function openCreate(canvasElement: HTMLElement) {
  await table(canvasElement)
  const create = within(canvasElement).getByRole("button", {
    name: "Create schedule",
  })
  await waitFor(() => expect(create).toBeEnabled())
  await userEvent.click(create)
  return within(
    await within(canvasElement.ownerDocument.body).findByRole("dialog")
  )
}
async function assertScheduleDateTimes(
  canvasElement: HTMLElement,
  locale: string
) {
  const row = await firstRow(canvasElement)
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: scheduleFixture.timeZone,
    dateStyle: "medium",
    timeStyle: "medium",
  })
  await expect(
    row.getByText(format.format(new Date(scheduleFixture.nextRunAt!)), {
      exact: true,
    })
  ).toBeVisible()
  await expect(
    row.getByText(format.format(new Date(scheduleFixture.lastRunAt!)), {
      exact: true,
    })
  ).toBeVisible()
}
async function assertRunDateTimes(
  canvasElement: HTMLElement,
  locale: string,
  finishedLabel: string,
  timeZoneLabel: string
) {
  await table(canvasElement)
  const canvas = within(canvasElement)
  await expect(canvas.getByText(timeZoneLabel, { exact: true })).toBeVisible()
  await expect(
    canvas.getByRole("columnheader", { name: finishedLabel })
  ).toBeVisible()
  const expected = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date("2026-10-19T00:00:00.000Z"))
  // 两条记录都必须展示完整起止时间；仅日期或只有开始列均无法通过。
  await expect(canvas.getAllByText(expected, { exact: true })).toHaveLength(4)
}
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await assertScheduleDateTimes(canvasElement, "en-US")
    await expect(
      within(canvasElement).getByRole("heading", { name: "Scheduled tasks" })
    ).toBeVisible()
  },
}
const paged = scenario()
export const ServerPagination: Story = {
  ...paged.story,
  play: async ({ canvasElement }) => {
    await table(canvasElement)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Next page" })
    )
    await waitFor(() =>
      expect(paged.fixture.queries.at(-1)?.get("page")).toBe("2")
    )
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole("row")).toHaveLength(6)
    )
  },
}
const created = scenario()
export const Create: Story = {
  ...created.story,
  play: async ({ canvasElement }) => {
    const dialog = await openCreate(canvasElement)
    const name = dialog.getByRole("textbox", { name: "Task name" })
    await userEvent.type(name, "Nightly service check")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(created.fixture.writes).toHaveLength(1))
    await expect(created.fixture.writes[0]?.body).toEqual({
      name: "Nightly service check",
      type: "platform.health-check",
      cron: "*/5 * * * *",
      timeZone: "Asia/Shanghai",
      status: "enabled",
    })
  },
}
export const InvalidInput: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await openCreate(canvasElement)
    const name = dialog.getByRole("textbox", { name: "Task name" })
    await userEvent.type(name, "   ")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"))
  },
}
const failed = scenario("saveError")
export const SaveErrorPreservesInput: Story = {
  ...failed.story,
  play: async ({ canvasElement }) => {
    const dialog = await openCreate(canvasElement)
    const name = dialog.getByRole("textbox", { name: "Task name" })
    await userEvent.type(name, "Keep this name")
    await userEvent.click(dialog.getByRole("button", { name: "Save" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Schedule request failed"
    )
    await expect(name).toHaveValue("Keep this name")
  },
}
const toggled = scenario()
export const DisableAndRunManually: Story = {
  ...toggled.story,
  play: async ({ canvasElement }) => {
    const row = await firstRow(canvasElement)
    await userEvent.click(row.getByRole("button", { name: "Disable" }))
    await waitFor(() => expect(toggled.fixture.writes[0]?.method).toBe("PATCH"))
    const updated = await firstRow(canvasElement)
    await expect(
      await updated.findByRole("button", { name: "Enable" })
    ).toBeEnabled()
    await userEvent.click(updated.getByRole("button", { name: "Run once" }))
    await waitFor(() =>
      expect(toggled.fixture.writes.at(-1)?.method).toBe("RUN")
    )
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveTextContent("manual run")
  },
}
const overlap = scenario("overlap")
export const OverlapRejected: Story = {
  ...overlap.story,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      (await firstRow(canvasElement)).getByRole("button", { name: "Run once" })
    )
    await expect(
      await within(canvasElement).findByRole("alert")
    ).toHaveTextContent("already running")
  },
}
const deleted = scenario()
export const DeleteConfirmation: Story = {
  ...deleted.story,
  play: async ({ canvasElement }) => {
    const row = await firstRow(canvasElement)
    await userEvent.click(row.getByRole("button", { name: "Delete" }))
    const screen = within(canvasElement.ownerDocument.body)
    let dialog = within(await screen.findByRole("alertdialog"))
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }))
    await expect(deleted.fixture.writes).toHaveLength(0)
    await userEvent.click(row.getByRole("button", { name: "Delete" }))
    dialog = within(await screen.findByRole("alertdialog"))
    await userEvent.click(dialog.getByRole("button", { name: "Delete" }))
    await waitFor(() =>
      expect(deleted.fixture.writes[0]?.method).toBe("DELETE")
    )
  },
}
export const ReadOnly: Story = {
  args: { readOnly: true, monitorAccess: false },
  play: async ({ canvasElement }) => {
    const row = await firstRow(canvasElement)
    await expect(row.queryByRole("button", { name: "Run once" })).toBeNull()
    await expect(
      within(canvasElement).queryByRole("button", { name: "Create schedule" })
    ).toBeNull()
    await expect(row.queryByRole("link", { name: "Run history" })).toBeNull()
  },
}
export const RunHistory: Story = {
  args: { showRuns: true },
  play: async ({ canvasElement }) => {
    await assertRunDateTimes(
      canvasElement,
      "en-US",
      "Finished at",
      "Record time zone: UTC"
    )
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Completed", { exact: true })).toBeVisible()
    await expect(canvas.getByText("Rejected", { exact: true })).toBeVisible()
    await expect(
      canvas.getByText(
        "The execution identity no longer has the required permissions."
      )
    ).toBeVisible()
  },
}
export const Loading: Story = { ...scenario("loading").story }
export const Empty: Story = { ...scenario("empty").story }
export const NarrowArabic: Story = {
  globals: { locale: "ar", viewport: { value: "mobile1", isRotated: false } },
}

export const MonitorReaderCanViewHistory: Story = {
  args: { readOnly: true, monitorAccess: true },
  play: async ({ canvasElement }) => {
    const row = await firstRow(canvasElement)
    await userEvent.click(row.getByRole("link", { name: "Run history" }))
    await expect(
      await within(canvasElement).findByRole("heading", { name: "Run history" })
    ).toBeVisible()
    await expect(
      await within(canvasElement).findByText("Completed", { exact: true })
    ).toBeVisible()
  },
}
export const HistoryRequiresMonitorPermission: Story = {
  args: { readOnly: true, monitorAccess: false, showRuns: true },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("heading", {
        name: "Access denied",
        level: 1,
      })
    ).toBeVisible()
    await expect(within(canvasElement).queryByRole("table")).toBeNull()
  },
}

export const AuthorizationUnavailable: Story = {
  ...scenario("authorizationUnavailable").story,
  args: { showRuns: true },
  play: async ({ canvasElement }) => {
    await table(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.getByText("Rejected", { exact: true })).toBeVisible()
    await expect(
      canvas.getByText(
        "Authorization could not be checked. The run was rejected.",
        { exact: true }
      )
    ).toBeVisible()
  },
}

export const DatesChinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) =>
    assertScheduleDateTimes(canvasElement, "zh-CN"),
}
export const DatesArabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) =>
    assertScheduleDateTimes(canvasElement, "ar"),
}
export const RunDatesChinese: Story = {
  args: { showRuns: true },
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) =>
    assertRunDateTimes(
      canvasElement,
      "zh-CN",
      "结束时间",
      "记录时间显示时区：UTC"
    ),
}
export const RunDatesArabic: Story = {
  args: { showRuns: true },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) =>
    assertRunDateTimes(
      canvasElement,
      "ar",
      "وقت الانتهاء",
      "المنطقة الزمنية لعرض السجلات: UTC"
    ),
}
