import type { Meta, StoryObj } from "@storybook/react-vite"
import {
  AuthenticatedSessionProvider,
  createWorkspaceAuthClient,
} from "@workspace/admin/auth"
import {
  createOrganizationAuditControlsScenario,
  organizationAuditMembers,
  organizationAuditUser,
  organizations,
} from "@workspace/mocks"
import { useState } from "react"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { MemberCombobox } from "./member-combobox"

const client = createWorkspaceAuthClient()
function MemberStory({
  initialValue = null,
  organizationId = organizations[0].id,
  disabled = false,
}: {
  initialValue?: string | null
  organizationId?: string
  disabled?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  // 选择值输出和标签仅用于交互断言；正式 Combobox 仍校验产品三语。
  // i18next-instrument-ignore
  return (
    <AuthenticatedSessionProvider client={client} user={organizationAuditUser}>
      <main className="w-80 space-y-2 p-4">
        <label htmlFor="member-choice">Member</label>
        <MemberCombobox
          id="member-choice"
          organizationId={organizationId}
          value={value}
          onValueChange={setValue}
          disabled={disabled}
        />
        <output aria-label="Selected member ID">{value ?? "none"}</output>
      </main>
    </AuthenticatedSessionProvider>
  )
}
function scenario(
  options?: Parameters<typeof createOrganizationAuditControlsScenario>[0]
) {
  const fixture = createOrganizationAuditControlsScenario(options)
  return {
    fixture,
    beforeEach: fixture.reset,
    parameters: { msw: { handlers: fixture.handlers } },
  }
}
const defaults = scenario()
const meta = {
  title: "Tenant/Current organization member combobox",
  component: MemberStory,
  globals: { locale: "en-US" },
  beforeEach: defaults.beforeEach,
  parameters: defaults.parameters,
} satisfies Meta<typeof MemberStory>
export default meta
type Story = StoryObj<typeof meta>

async function open(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const trigger = canvas.getByRole("combobox", { name: "Member" })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  const screen = within(canvasElement.ownerDocument.body)
  const input = await screen.findByRole("combobox", {
    name: "Search current organization members",
  })
  await waitFor(() => expect(input).toBeVisible())
  return { canvas, screen, trigger, input }
}
async function closedPopup(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body)
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { hidden: true })
    ).not.toBeInTheDocument()
  )
}
const firstOption = "Morgan Audit"
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, screen, trigger, input } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await expect(input).toHaveFocus()
    await expect(screen.getAllByRole("option")).toHaveLength(20)
    await expect(defaults.fixture.memberRequests()).toEqual([
      { organizationId: organizations[0].id, query: { page: 1, pageSize: 20 } },
    ])
    await userEvent.keyboard("{Escape}")
    await waitFor(() => expect(trigger).toHaveFocus())
    await closedPopup(canvasElement)
    await expect(canvas.getByLabelText("Selected member ID")).toHaveTextContent(
      "none"
    )
  },
}
const lazy = scenario()
export const LazyAndDisabled: Story = {
  beforeEach: lazy.beforeEach,
  parameters: lazy.parameters,
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("combobox", { name: "Member" })
    ).toBeDisabled()
    await expect(lazy.fixture.memberRequests()).toHaveLength(0)
  },
}
const keyboard = scenario()
export const KeyboardSelectionAndClear: Story = {
  beforeEach: keyboard.beforeEach,
  parameters: keyboard.parameters,
  play: async ({ canvasElement }) => {
    const { canvas, screen, trigger } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await userEvent.keyboard("{ArrowDown}{Enter}")
    await waitFor(() =>
      expect(canvas.getByLabelText("Selected member ID")).not.toHaveTextContent(
        "none"
      )
    )
    await waitFor(() => expect(trigger).toHaveFocus())
    await closedPopup(canvasElement)
    const clear = canvas.getByRole("button", { name: "Clear selection" })
    await userEvent.click(clear)
    await expect(canvas.getByLabelText("Selected member ID")).toHaveTextContent(
      "none"
    )
    await expect(trigger).toHaveTextContent("All actors")
  },
}
const paging = scenario()
export const ServerPagination: Story = {
  beforeEach: paging.beforeEach,
  parameters: paging.parameters,
  play: async ({ canvasElement }) => {
    const { screen, canvas } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await userEvent.click(
      screen.getByRole("button", { name: "Load more members" })
    )
    await screen.findByRole("option", {
      name: "Tenant Member 25",
    })
    await expect(screen.getAllByRole("option")).toHaveLength(25)
    await expect(
      paging.fixture.memberRequests().map((request) => request.query.page)
    ).toEqual([1, 2])
    await expect(
      screen.queryByRole("button", { name: "Load more members" })
    ).toBeNull()
    await userEvent.click(
      screen.getByRole("option", {
        name: "Tenant Member 25",
      })
    )
    await expect(canvas.getByLabelText("Selected member ID")).toHaveTextContent(
      organizationAuditMembers[24].userId
    )
    await closedPopup(canvasElement)
  },
}
const searching = scenario()
export const SearchByNameUsesServer: Story = {
  beforeEach: searching.beforeEach,
  parameters: searching.parameters,
  play: async ({ canvasElement }) => {
    const { canvas, screen, input } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await userEvent.type(input, "Tenant Member 25")
    await screen.findByRole("option", {
      name: "Tenant Member 25",
    })
    await expect(screen.getAllByRole("option")).toHaveLength(1)
    await expect(searching.fixture.memberRequests().at(-1)).toEqual({
      organizationId: organizations[0].id,
      query: { q: "Tenant Member 25", page: 1, pageSize: 20 },
    })
    await userEvent.click(
      screen.getByRole("option", {
        name: "Tenant Member 25",
      })
    )
    await expect(canvas.getByLabelText("Selected member ID")).toHaveTextContent(
      organizationAuditMembers[24].userId
    )
    await closedPopup(canvasElement)
  },
}
const selected = scenario()
export const ExactSelectionOutsideFirstPage: Story = {
  beforeEach: selected.beforeEach,
  parameters: selected.parameters,
  args: { initialValue: organizationAuditMembers[24].userId },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() =>
      expect(
        canvas.getByRole("combobox", { name: "Member" })
      ).toHaveTextContent("Tenant Member 25")
    )
    await expect(selected.fixture.memberRequests()).toEqual([
      {
        organizationId: organizations[0].id,
        query: {
          userId: organizationAuditMembers[24].userId,
          page: 1,
          pageSize: 1,
        },
      },
    ])
    const { screen } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await expect(screen.getAllByRole("option")).toHaveLength(20)
    await expect(
      canvas.getByRole("combobox", { name: "Member" })
    ).toHaveTextContent("Tenant Member 25")
  },
}
const former = scenario()
const formerId = "c7dd0a27-4f8a-4aef-8d4c-000000009999"
export const FormerMemberKeepsHistoricalId: Story = {
  beforeEach: former.beforeEach,
  parameters: former.parameters,
  args: { initialValue: formerId },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(
      "This user has left the organization. Historical activity can still be filtered."
    )
    await expect(
      canvas.getByRole("combobox", { name: "Member" })
    ).toHaveTextContent(formerId)
    await expect(canvas.getByLabelText("Selected member ID")).toHaveTextContent(
      formerId
    )
    await expect(former.fixture.memberRequests()[0].query.userId).toBe(formerId)
  },
}
const noMatches = scenario()
export const NoMatches: Story = {
  beforeEach: noMatches.beforeEach,
  parameters: noMatches.parameters,
  play: async ({ canvasElement }) => {
    const { screen, input } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await userEvent.type(input, "missing-person")
    await screen.findByText("No matching members")
    await expect(screen.queryByRole("option")).toBeNull()
  },
}
const loading = scenario({ members: "loading" })
export const Loading: Story = {
  beforeEach: loading.beforeEach,
  parameters: loading.parameters,
  play: async ({ canvasElement }) => {
    const { screen } = await open(canvasElement)
    await expect(
      await within(screen.getByRole("dialog")).findByRole("status")
    ).toHaveTextContent("Loading…")
    await expect(screen.queryByRole("option")).toBeNull()
  },
}
const denied = scenario({ members: "forbidden" })
export const AuditReadDenied: Story = {
  beforeEach: denied.beforeEach,
  parameters: denied.parameters,
  play: async ({ canvasElement }) => {
    const { screen } = await open(canvasElement)
    await screen.findByRole("alert")
    await expect(screen.queryByRole("option")).toBeNull()
    await expect(screen.queryByText(organizationAuditUser.email)).toBeNull()
  },
}
const expired = scenario({ members: "unauthorized" })
export const SessionExpired: Story = {
  beforeEach: expired.beforeEach,
  parameters: expired.parameters,
  play: async ({ canvasElement }) => {
    const { screen } = await open(canvasElement)
    await screen.findByRole("alert")
    await expect(screen.queryByRole("option")).toBeNull()
  },
}
const exactDenied = scenario({ members: "forbidden" })
export const ExactLookupDeniedDoesNotShowIdentity: Story = {
  beforeEach: exactDenied.beforeEach,
  parameters: exactDenied.parameters,
  args: { initialValue: organizationAuditUser.id },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("alert")
    await expect(
      canvas.getByRole("combobox", { name: "Member" })
    ).toHaveTextContent(organizationAuditUser.id)
    await expect(canvas.queryByText(organizationAuditUser.name)).toBeNull()
    await expect(canvas.queryByText(organizationAuditUser.email)).toBeNull()
    await expect(canvas.queryByText(/This user has left/)).toBeNull()
  },
}
const retry = scenario({ members: "retryable" })
export const RetryRestoresCandidates: Story = {
  beforeEach: retry.beforeEach,
  parameters: retry.parameters,
  play: async ({ canvasElement }) => {
    const { screen } = await open(canvasElement)
    await screen.findByRole("alert")
    await userEvent.click(screen.getByRole("button", { name: "Retry" }))
    await screen.findByRole("option", { name: firstOption })
    await expect(retry.fixture.memberRequests()).toHaveLength(2)
  },
}
const foreign = scenario()
export const OtherOrganizationIsRejected: Story = {
  beforeEach: foreign.beforeEach,
  parameters: foreign.parameters,
  args: { organizationId: organizations[1].id },
  play: async ({ canvasElement }) => {
    const { screen } = await open(canvasElement)
    await screen.findByRole("alert")
    await expect(screen.queryByRole("option")).toBeNull()
    await expect(
      foreign.fixture
        .memberRequests()
        .every((request) => request.organizationId === organizations[1].id)
    ).toBe(true)
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("combobox", { name: "Member" })
    ).toHaveTextContent("全部操作者")
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("combobox", { name: "Member" })).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}

const revoked = scenario()
export const RevokedReadHidesCachedCandidates: Story = {
  beforeEach: revoked.beforeEach,
  parameters: revoked.parameters,
  play: async ({ canvasElement }) => {
    const { canvas, screen, trigger } = await open(canvasElement)
    await userEvent.click(
      await screen.findByRole("option", { name: firstOption })
    )
    await closedPopup(canvasElement)
    await waitFor(() =>
      expect(trigger).toHaveTextContent(organizationAuditUser.name)
    )
    revoked.fixture.revoke()
    await userEvent.click(trigger)
    await screen.findByRole("alert")
    await expect(screen.queryByRole("option")).toBeNull()
    await expect(
      canvas.getByRole("combobox", { name: "Member" })
    ).toHaveTextContent(organizationAuditUser.id)
    await expect(screen.queryByText(organizationAuditUser.name)).toBeNull()
    await expect(screen.queryByText(organizationAuditUser.email)).toBeNull()
  },
}
const arbitrarySearch = scenario()
export const SearchTextCannotBecomeAnActorId: Story = {
  beforeEach: arbitrarySearch.beforeEach,
  parameters: arbitrarySearch.parameters,
  play: async ({ canvasElement }) => {
    const { canvas, screen, input } = await open(canvasElement)
    await screen.findByRole("option", { name: firstOption })
    await userEvent.type(input, "not-a-member")
    await screen.findByText("No matching members")
    await expect(arbitrarySearch.fixture.memberRequests().at(-1)?.query.q).toBe(
      "not-a-member"
    )
    await userEvent.keyboard("{Enter}")
    await expect(canvas.getByLabelText("Selected member ID")).toHaveTextContent(
      "none"
    )
    await userEvent.keyboard("{Escape}")
    await closedPopup(canvasElement)
  },
}
