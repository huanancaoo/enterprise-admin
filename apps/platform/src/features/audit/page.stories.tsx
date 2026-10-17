import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  expect,
  fireEvent,
  spyOn,
  userEvent,
  waitFor,
  within,
} from "storybook/test"
import {
  createPlatformAuditScenario,
  createPlatformEntityComboboxScenario,
  createPlatformOrganizationScenario,
  createPlatformUsersScenario,
  createWorkspaceSessionHandlers,
  platformAuditFixture,
  type PlatformAuditScenario,
} from "@workspace/mocks"
import { PlatformReadPageStory } from "../platform-read-page.story-fixture"

const scenario = (name: PlatformAuditScenario = "success") => {
  const fixture = createPlatformAuditScenario(name)
  const organizations = createPlatformOrganizationScenario()
  const users = createPlatformUsersScenario()
  return {
    beforeEach: () => {
      fixture.reset()
      organizations.reset()
      users.reset()
    },
    parameters: {
      layout: "fullscreen",
      msw: {
        handlers: [
          ...fixture.handlers,
          ...organizations.handlers,
          ...users.handlers,
          ...createWorkspaceSessionHandlers(),
        ],
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
  const dialog = await within(canvasElement.ownerDocument.body).findByRole(
    "dialog",
    {
      name: "Advanced filters",
    }
  )
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
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
async function finishFiniteAnimations(element: HTMLElement) {
  const animations = element.getAnimations().filter((animation) => {
    const endTime = animation.effect?.getComputedTiming().endTime
    return typeof endTime === "number" && Number.isFinite(endTime)
  })
  await Promise.allSettled(animations.map((animation) => animation.finished))
}
async function closed(screen: ReturnType<typeof within>) {
  const dialogs = screen.queryAllByRole("dialog", { hidden: true })
  await Promise.all(dialogs.map(finishFiniteAnimations))
  await waitFor(
    () =>
      expect(screen.queryAllByRole("dialog", { hidden: true })).toHaveLength(0),
    { timeout: 5000 }
  )
}
async function directoryClosed(trigger: HTMLElement, search: HTMLElement) {
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"))
  const popup = search.closest<HTMLElement>('[data-slot="combobox-content"]')
  if (popup) {
    await finishFiniteAnimations(popup)
    await waitFor(() => expect(popup).not.toBeInTheDocument(), {
      timeout: 5000,
    })
  }
  await waitFor(() => expect(trigger).toHaveFocus(), { timeout: 5000 })
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
    await expect(
      panel.getByRole("combobox", { name: "Organization" })
    ).toBeVisible()
    await expect(panel.getByRole("combobox", { name: "Actor" })).toBeVisible()
    await expect(
      panel.queryByRole("textbox", { name: "Organization ID" })
    ).toBeNull()
    await expect(panel.queryByRole("textbox", { name: "Actor ID" })).toBeNull()
    await expect(
      panel.queryByRole("button", { name: /Filter .* by ID/ })
    ).toBeNull()
    const trigger = panel.getByRole("combobox", { name: "Organization" })
    await userEvent.click(trigger)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await screen.findByRole("option", { name: /South workspace/ })
    )
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    await userEvent.keyboard("{Escape}")
    const reopened = await filters(canvasElement)
    await expect(
      reopened.getByRole("combobox", { name: "Organization" })
    ).toHaveTextContent("South workspace")
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
      panel.getByRole("combobox", { name: "Organization" })
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
      panel.getByRole("combobox", { name: "Organization" })
    ).toBeEnabled()
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
    fireEvent.change(panel.getByLabelText("From (UTC)"), {
      target: { value: "2026-01-02T00:00" },
    })
    fireEvent.change(panel.getByLabelText("To (UTC)"), {
      target: { value: "2026-01-01T00:00" },
    })
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
    const organization = panel.getByRole("combobox", { name: "Organization" })
    // 上一页缓存行会先出现；筛选要等当前读回结束后才恢复可编辑。
    await waitFor(() => expect(organization).toBeEnabled())
    await userEvent.click(organization)
    const directoryScreen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await directoryScreen.findByRole("option", { name: /South workspace/ })
    )
    await waitFor(() =>
      expect(organization).toHaveTextContent("South workspace")
    )
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(directoryScreen)
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

const organizationSearch = "Search organizations by name, slug, or ID"
const userSearch = "Search users by name, masked email, or ID"
const historyId = "c7dd0a27-4f8a-4aef-8d4c-999999999999"
const selectedOrganizationId = "c7dd0a27-4f8a-4aef-8d4c-000000000002"
const auditEntryWithOrganization = (id: string) =>
  `/platform/audit-events?organizationId=${id}`
const directoryScenario = (
  name: Parameters<typeof createPlatformEntityComboboxScenario>[0] = "success"
) => {
  const directory = createPlatformEntityComboboxScenario(name)
  const audit = createPlatformAuditScenario()
  return {
    directory,
    story: {
      beforeEach: () => {
        directory.reset()
        audit.reset()
      },
      parameters: {
        layout: "fullscreen",
        msw: {
          handlers: [
            ...directory.handlers,
            ...audit.handlers,
            ...createWorkspaceSessionHandlers(),
          ],
        },
      },
    },
  }
}
async function openDirectory(
  canvasElement: HTMLElement,
  entity: "Organization" | "Actor" = "Organization"
) {
  const panel = await filters(canvasElement)
  const trigger = panel.getByRole("combobox", { name: entity })
  await userEvent.click(trigger)
  const screen = within(canvasElement.ownerDocument.body)
  const search = await screen.findByPlaceholderText(
    entity === "Organization" ? organizationSearch : userSearch
  )
  const popup = search.closest<HTMLElement>('[data-slot="combobox-content"]')
  if (popup) await finishFiniteAnimations(popup)
  await waitFor(() => expect(search).toBeVisible())
  return { panel, screen, search, trigger }
}

const draftDirectory = directoryScenario()
export const DirectorySelectionAppliesOnlyOnSubmit: Story = {
  ...draftDirectory.story,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    await waitFor(() =>
      expect(draftDirectory.directory.requests.audit).toHaveLength(1)
    )
    const initialReads = draftDirectory.directory.requests.audit.length
    const { panel, screen, search, trigger } =
      await openDirectory(canvasElement)
    await userEvent.click(
      await screen.findByRole("option", { name: /South workspace/ })
    )
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    await directoryClosed(trigger, search)
    await expect(draftDirectory.directory.requests.audit).toHaveLength(
      initialReads
    )
    await expect(draftDirectory.directory.requests.users).toHaveLength(0)
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(screen)
    await canvas.findByText("member.role_changed")
    await waitFor(() =>
      expect(draftDirectory.directory.requests.audit.at(-1)).toMatchObject({
        organizationId: draftDirectory.directory.organizations[1].id,
        page: "1",
        pageSize: "20",
      })
    )
    await expect(canvas.queryByText(platformAuditFixture.eventCode)).toBeNull()
  },
}

const pageDirectory = directoryScenario()
export const DirectoryLoadsTwentyThenAppends: Story = {
  ...pageDirectory.story,
  play: async ({ canvasElement }) => {
    const { screen, search } = await openDirectory(canvasElement)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))
    await expect(search).toHaveFocus()
    const loadMore = screen.getByRole("button", { name: "Load more" })
    await expect(loadMore.closest('[role="listbox"]')).toBeNull()
    await userEvent.tab()
    await expect(loadMore).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(25))
    await expect(search).toHaveFocus()
    await expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
    await expect(
      pageDirectory.directory.requests.organizations.map(
        ({ page, pageSize }) => [page, pageSize]
      )
    ).toEqual([
      [1, 20],
      [2, 20],
    ])
    await expect(
      new Set(screen.getAllByRole("option").map((option) => option.textContent))
        .size
    ).toBe(25)
  },
}

const retryDirectory = directoryScenario("retryNextPage")
export const DirectoryRetriesSamePageWithoutLosingOptions: Story = {
  ...retryDirectory.story,
  play: async ({ canvasElement }) => {
    const { screen, search } = await openDirectory(canvasElement)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))
    const loadMore = screen.getByRole("button", { name: "Load more" })
    await expect(loadMore.closest('[role="listbox"]')).toBeNull()
    await userEvent.tab()
    await expect(loadMore).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    const retry = await screen.findByRole("button", { name: "Retry" })
    await expect(screen.getAllByRole("option")).toHaveLength(20)
    await expect(retry.closest('[role="listbox"]')).toBeNull()
    await expect(search).toHaveFocus()
    await userEvent.tab()
    await expect(retry).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(25))
    await expect(search).toHaveFocus()
    await expect(
      retryDirectory.directory.requests.organizations.map(({ page }) => page)
    ).toEqual([1, 2, 2])
  },
}

const searchDirectory = directoryScenario("slowSearch")
export const SearchCancelsObsoleteCandidates: Story = {
  ...searchDirectory.story,
  play: async ({ canvasElement }) => {
    const fetchSpy = spyOn(window, "fetch")
    try {
      const { screen, search } = await openDirectory(canvasElement)
      await screen.findByRole("option", { name: /North workspace/ })
      await userEvent.type(search, "North")
      const obsoleteRequest = () =>
        fetchSpy.mock.calls.find(([input]) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
            window.location.href
          )
          return (
            url.pathname.endsWith("/platform/organizations") &&
            url.searchParams.get("q") === "North"
          )
        })
      await waitFor(() => expect(obsoleteRequest()).toBeDefined())
      await expect(
        screen.queryByRole("option", { name: /South workspace/ })
      ).toBeNull()
      await userEvent.clear(search)
      await userEvent.type(search, "South")
      await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
      await expect(
        screen.getByRole("option", { name: /South workspace/ })
      ).toBeVisible()
      await expect(
        screen.queryByRole("option", { name: /North workspace/ })
      ).toBeNull()
      // MSW worker 的 Request 不能反映调用端取消；直接观察 fetch 接到的原始信号。
      await waitFor(() =>
        expect(obsoleteRequest()?.[1]?.signal?.aborted).toBe(true)
      )
      await expect(searchDirectory.directory.requests.audit).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
    }
  },
}

const clearDirectory = directoryScenario()
export const DirectorySelectionCanBeCleared: Story = {
  ...clearDirectory.story,
  play: async ({ canvasElement }) => {
    const { panel, screen, search, trigger } =
      await openDirectory(canvasElement)
    await userEvent.click(
      await screen.findByRole("option", { name: /South workspace/ })
    )
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    await directoryClosed(trigger, search)
    await userEvent.click(
      panel.getByRole("button", { name: "Clear selection" })
    )
    await expect(trigger).not.toHaveTextContent("South workspace")
    await expect(clearDirectory.directory.requests.audit).toHaveLength(1)
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(screen)
    await waitFor(() =>
      expect(
        clearDirectory.directory.requests.audit.at(-1)?.organizationId
      ).toBeUndefined()
    )
  },
}

const historicalDirectory = directoryScenario()
export const UrlSelectionSurvivesMissingDirectoryRecord: Story = {
  ...historicalDirectory.story,
  args: { initialEntry: auditEntryWithOrganization(historyId) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Operation logs" })
    const panel = await filters(canvasElement)
    const trigger = panel.getByRole("combobox", { name: "Organization" })
    await waitFor(() => expect(trigger).toHaveTextContent(historyId))
    await expect(historicalDirectory.directory.requests.audit).toHaveLength(1)
    await userEvent.click(trigger)
    const screen = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))
    await expect(
      screen.queryByRole("option", { name: new RegExp(historyId) })
    ).toBeNull()
    await userEvent.keyboard("{Escape}")
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(screen)
    await waitFor(() =>
      expect(
        historicalDirectory.directory.requests.audit.at(-1)?.organizationId
      ).toBe(historyId)
    )
    const reopened = await filters(canvasElement)
    await expect(
      reopened.getByRole("combobox", { name: "Organization" })
    ).toHaveTextContent(historyId)
  },
}

const uuidDirectory = directoryScenario()
export const FullOrganizationIdUsesDetailLookup: Story = {
  ...uuidDirectory.story,
  play: async ({ canvasElement }) => {
    const { screen, search } = await openDirectory(canvasElement)
    await userEvent.type(search, uuidDirectory.directory.organizations[1].id)
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    await expect(
      screen.getByRole("option", { name: /South workspace/ })
    ).toBeVisible()
    await expect(
      uuidDirectory.directory.requests.organizationDetails
    ).toContain(uuidDirectory.directory.organizations[1].id)
    await expect(
      uuidDirectory.directory.requests.organizations.some(
        ({ q }) => q === uuidDirectory.directory.organizations[1].id
      )
    ).toBe(false)
  },
}

const duplicateDirectory = directoryScenario()
export const SameNameActorsUseMaskedEmailAndShortId: Story = {
  ...duplicateDirectory.story,
  play: async ({ canvasElement }) => {
    const { panel, screen, search, trigger } = await openDirectory(
      canvasElement,
      "Actor"
    )
    const first = await screen.findByRole("option", {
      name: new RegExp(duplicateDirectory.directory.users[0].userId),
    })
    const second = screen.getByRole("option", {
      name: new RegExp(duplicateDirectory.directory.users[1].userId),
    })
    await expect(first).toHaveTextContent("Mina Chen")
    await expect(first).toHaveTextContent("m***@example.test")
    await expect(first).toHaveTextContent("00001001")
    await expect(second).toHaveTextContent("00001002")
    await userEvent.click(second)
    await waitFor(() => expect(trigger).toHaveTextContent("Mina Chen"))
    await directoryClosed(trigger, search)
    await waitFor(() => expect(trigger).toHaveTextContent("m***@example.test"))
    await expect(
      duplicateDirectory.directory.requests.organizations
    ).toHaveLength(0)
    await expect(duplicateDirectory.directory.requests.sensitiveProfiles).toBe(
      0
    )
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(screen)
    await waitFor(() =>
      expect(duplicateDirectory.directory.requests.audit.at(-1)?.actorId).toBe(
        duplicateDirectory.directory.users[1].userId
      )
    )
  },
}

const imeDirectory = directoryScenario()
export const ImeEnterDoesNotSelectOrSubmit: Story = {
  ...imeDirectory.story,
  play: async ({ canvasElement }) => {
    const { panel, screen, search, trigger } =
      await openDirectory(canvasElement)
    await screen.findByRole("option", { name: /North workspace/ })
    await userEvent.keyboard("{ArrowDown}")
    fireEvent.compositionStart(search)
    fireEvent.keyDown(search, {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    })
    fireEvent.compositionEnd(search)
    fireEvent.keyDown(search, { key: "Enter", code: "Enter", keyCode: 229 })
    await expect(search).toBeVisible()
    await expect(
      panel.getByRole("button", { name: "Apply filters" })
    ).toBeVisible()
    await expect(trigger).not.toHaveTextContent("North workspace")
    await expect(imeDirectory.directory.requests.audit).toHaveLength(1)
  },
}

export const NestedEscapeClosesOneLayerAtATime: Story = {
  play: async ({ canvasElement }) => {
    const { panel, screen, search, trigger } =
      await openDirectory(canvasElement)
    await screen.findByRole("option", { name: /North workspace/ })
    await userEvent.keyboard("{Escape}")
    await directoryClosed(trigger, search)
    await expect(
      panel.getByRole("button", { name: "Apply filters" })
    ).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await closed(screen)
  },
}

const forbiddenDirectory = directoryScenario("forbidden")
export const DirectoryPermissionDeniedHidesIdentity: Story = {
  ...forbiddenDirectory.story,
  play: async ({ canvasElement }) => {
    const panel = await filters(canvasElement)
    await userEvent.click(panel.getByRole("combobox", { name: "Organization" }))
    const screen = within(canvasElement.ownerDocument.body)
    await within(canvasElement).findByRole("heading", {
      name: "Platform access denied",
    })
    await expect(screen.queryByRole("option")).toBeNull()
    await expect(screen.queryByText("North workspace")).toBeNull()
  },
}
const expiredDirectory = directoryScenario("unauthorized")
export const DirectorySessionExpiredHidesIdentity: Story = {
  ...expiredDirectory.story,
  play: async ({ canvasElement }) => {
    const panel = await filters(canvasElement)
    await userEvent.click(panel.getByRole("combobox", { name: "Organization" }))
    const screen = within(canvasElement.ownerDocument.body)
    await within(canvasElement).findByRole("heading", { name: "Sign in" })
    await expect(screen.queryByRole("option")).toBeNull()
  },
}

const longDirectory = directoryScenario("longText")
export const LongDirectoryLabelsInNarrowContainer: Story = {
  ...longDirectory.story,
  decorators: [
    (Story) => (
      <div style={{ width: 375, maxWidth: "100%" }}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const { screen, search, trigger } = await openDirectory(canvasElement)
    const option = await screen.findByRole("option", {
      name: /International research and compliance workspace/,
    })
    await expect(option).toBeVisible()
    await userEvent.click(option)
    await directoryClosed(trigger, search)
  },
}

export const DirectoryKeyboardInRtl: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    const advanced = canvas.getByRole("button", { name: /^عوامل تصفية متقدمة/ })
    await waitFor(() => expect(advanced).toBeEnabled())
    await userEvent.click(advanced)
    const screen = within(canvasElement.ownerDocument.body)
    const panel = within(
      await screen.findByRole("dialog", { name: "عوامل تصفية متقدمة" })
    )
    const trigger = panel.getAllByRole("combobox")[0]
    await userEvent.click(trigger)
    await screen.findByRole("option", { name: /North workspace/ })
    const search = screen
      .getAllByRole("combobox")
      .find((element) => element.tagName === "INPUT")
    await expect(search).toBeDefined()
    await userEvent.type(search!, "North")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1))
    await userEvent.keyboard("{ArrowDown}{Enter}")
    await waitFor(() => expect(trigger).toHaveTextContent("North workspace"))
    await directoryClosed(trigger, search!)
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}

const badRequestDirectory = directoryScenario("badRequest")
export const DirectoryBadRequestIsNotAnEmptyResult: Story = {
  ...badRequestDirectory.story,
  play: async ({ canvasElement }) => {
    const { screen, search } = await openDirectory(canvasElement)
    await screen.findByText("Could not load organizations.")
    await expect(screen.queryByText("No matching organizations")).toBeNull()
    await expect(screen.queryByRole("option")).toBeNull()
    await expect(search).toBeVisible()
    await expect(screen.getByRole("button", { name: "Retry" })).toBeVisible()
    await expect(badRequestDirectory.directory.requests.audit).toHaveLength(1)
  },
}

const firstPageDirectory = directoryScenario("retryFirstPage")
export const DirectoryFailureAndEmptySearchKeepTheSelection: Story = {
  ...firstPageDirectory.story,
  args: { initialEntry: auditEntryWithOrganization(selectedOrganizationId) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("table")
    const panel = await filters(canvasElement)
    const selectedId = selectedOrganizationId
    const trigger = panel.getByRole("combobox", { name: "Organization" })
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    await userEvent.click(trigger)
    const screen = within(canvasElement.ownerDocument.body)
    const search = await screen.findByPlaceholderText(organizationSearch)
    await screen.findByText("Could not load organizations.")
    await expect(screen.queryByText("No matching organizations")).toBeNull()
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    const retry = screen.getByRole("button", { name: "Retry" })
    await expect(retry.closest('[role="listbox"]')).toBeNull()
    await userEvent.tab()
    await expect(retry).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20))
    await expect(search).toHaveFocus()
    await userEvent.type(search, "No directory record matches this query")
    await screen.findByText("No matching organizations")
    await expect(screen.queryByRole("option")).toBeNull()
    await userEvent.keyboard("{Enter}")
    await expect(search).toBeVisible()
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    await expect(
      panel.getByRole("button", { name: "Apply filters" })
    ).toBeVisible()
    await expect(firstPageDirectory.directory.requests.audit).toHaveLength(1)
    await userEvent.keyboard("{Escape}")
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(screen)
    await waitFor(() =>
      expect(
        firstPageDirectory.directory.requests.audit.at(-1)?.organizationId
      ).toBe(selectedId)
    )
  },
}

const selectedRetryDirectory = directoryScenario("retrySelected")
export const SelectedRecordFailureKeepsIdAndCanRetry: Story = {
  ...selectedRetryDirectory.story,
  args: { initialEntry: auditEntryWithOrganization(selectedOrganizationId) },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("table")
    const panel = await filters(canvasElement)
    const selectedId = selectedOrganizationId
    const trigger = panel.getByRole("combobox", { name: "Organization" })
    await waitFor(() =>
      expect(trigger).toHaveTextContent("Could not load the selected record.")
    )
    await expect(
      selectedRetryDirectory.directory.requests.organizationDetails
    ).toEqual([selectedId])
    const retry = await panel.findByRole("button", { name: "Retry" })
    await expect(
      panel.queryByText("This ID is not in the current directory")
    ).toBeNull()
    await expect(retry.closest('[role="listbox"]')).toBeNull()
    trigger.focus()
    await userEvent.tab()
    await expect(
      panel.getByRole("button", { name: "Clear selection" })
    ).toHaveFocus()
    await userEvent.tab()
    await expect(retry).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(trigger).toHaveTextContent("South workspace"))
    await waitFor(() => expect(trigger).toHaveFocus(), { timeout: 5000 })
    await expect(
      selectedRetryDirectory.directory.requests.organizationDetails
    ).toEqual([selectedId, selectedId])
    await expect(selectedRetryDirectory.directory.requests.audit).toHaveLength(
      1
    )
    await userEvent.click(panel.getByRole("button", { name: "Apply filters" }))
    await closed(within(canvasElement.ownerDocument.body))
    await waitFor(() =>
      expect(
        selectedRetryDirectory.directory.requests.audit.at(-1)?.organizationId
      ).toBe(selectedId)
    )
  },
}
