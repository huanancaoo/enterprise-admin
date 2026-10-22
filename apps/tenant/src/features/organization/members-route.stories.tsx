import type { Meta, StoryObj } from "@storybook/react-vite"
import { createMembersScenario, type MembersScenario } from "@workspace/mocks"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { MembersStory } from "./members.story-fixture"

const scenario = (name: MembersScenario = "success") => {
  const fixture = createMembersScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
  }
}
const meta = {
  title: "Admin/Members",
  component: MembersStory,
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof MembersStory>
export default meta
type Story = StoryObj<typeof meta>
async function memberBody(canvasElement: HTMLElement) {
  const tables = await within(canvasElement).findAllByRole("table", {
    hidden: true,
  })
  await waitFor(() => expect(tables[0]!).toHaveAttribute("aria-busy", "false"))
  return tables[0]!.querySelector("tbody")!
}
const loaded: Story["play"] = async ({ canvasElement }) => {
  await within(canvasElement).findByText("Morgan Owner")
  await waitFor(async () =>
    expect(
      within(await memberBody(canvasElement)).getAllByRole("row")
    ).toHaveLength(4)
  )
}
async function row(canvasElement: HTMLElement, name = "Casey Reader") {
  let target: HTMLElement | null = null
  await waitFor(() => {
    const table = canvasElement.querySelector<HTMLElement>(
      '[data-slot="table"]'
    )!
    expect(table).not.toBeNull()
    target = within(table).getByText(name).closest("tr")
    expect(target).not.toBeNull()
  })
  return within(target!)
}
async function dialog(
  canvasElement: HTMLElement,
  kind: "role" | "remove" | "leave" = "role",
  name?: string
) {
  const trigger =
    kind === "leave"
      ? await within(canvasElement).findByRole("button", {
          name: "Leave organization",
        })
      : await (
          await row(canvasElement, name)
        ).findByRole("button", {
          name: kind === "role" ? "Change role" : "Remove member",
        })
  await waitFor(() => expect(trigger).toBeEnabled())
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  const screen = within(canvasElement.ownerDocument.body)
  const popup = await screen.findByRole("dialog")
  await waitFor(() => expect(popup).toBeVisible())
  return { screen, popup, content: within(popup), trigger }
}
async function selectRole(
  canvasElement: HTMLElement,
  name = "project-editor",
  target?: string
) {
  const result = await dialog(canvasElement, "role", target)
  await userEvent.click(result.content.getByRole("combobox", { name: "Role" }))
  const option = await result.screen.findByRole("option", { name })
  const list = result.screen.getByRole("listbox")
  await userEvent.click(option)
  await waitFor(() => expect(list).not.toBeVisible())
  return result
}
async function closed(popup: HTMLElement) {
  await waitFor(() => expect(popup).not.toBeInTheDocument(), { timeout: 2000 })
}
export const Default: Story = { play: loaded }
export const RemovalHover: Story = {
  play: async ({ canvasElement }) => {
    const action = await (
      await row(canvasElement)
    ).findByRole("button", { name: "Remove member" })
    await userEvent.hover(action)
    await new Promise((resolve) =>
      canvasElement.ownerDocument.defaultView!.requestAnimationFrame(resolve)
    )
    await Promise.all(
      action.getAnimations().map((animation) => animation.finished)
    )
    await expect(action).toBeEnabled()
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findAllByText("Loading…")
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No matching members")
  },
}
const readError: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.queryByText("Casey Reader")).toBeNull()
}
export const Error: Story = { ...scenario("unavailable"), play: readError }
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: readError,
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: readError,
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(
      "international-collaboration-member-".repeat(5)
    )
    const html = canvasElement.ownerDocument.documentElement
    await expect(html.scrollWidth).toBe(html.clientWidth)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await memberBody(canvasElement)
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await expect(canvas.getByRole("heading", { name: "الأعضاء" })).toBeVisible()
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await memberBody(canvasElement)
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("status")
    await memberBody(canvasElement)
  },
}
export const MemberReadOnly: Story = {
  ...scenario("member"),
  play: async ({ canvasElement }) => {
    const target = await row(canvasElement)
    await expect(target.queryByRole("button")).toBeNull()
    await expect(
      within(canvasElement).queryByRole("heading", { name: "Invitations" })
    ).toBeNull()
  },
}
export const AdminManagesOrdinaryMember: Story = {
  ...scenario("admin"),
  play: async ({ canvasElement }) => {
    await expect(
      await (
        await row(canvasElement)
      ).findByRole("button", { name: "Change role" })
    ).toBeEnabled()
    for (const name of ["Blair Admin", "Owen Owner"])
      await expect(
        (await row(canvasElement, name)).queryByRole("button")
      ).toBeNull()
  },
}
export const SelfCannotBeRemoved: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      (await row(canvasElement, "Morgan Owner")).queryByRole("button", {
        name: "Remove member",
      })
    ).toBeNull()
  },
}
export const AccessUnavailable: Story = {
  ...scenario("accessUnavailable"),
  play: async ({ canvasElement }) => {
    await row(canvasElement)
    await expect(
      within(canvasElement).getByRole("button", { name: "Leave organization" })
    ).toBeDisabled()
    await expect(
      await (
        await row(canvasElement)
      ).findByRole("button", { name: "Change role" })
    ).toBeDisabled()
  },
}
export const FilterAndPagination: Story = {
  ...scenario("paginated"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const members = within(
      (await memberBody(canvasElement)).closest("fieldset")!
    )
    await expect(
      within(await memberBody(canvasElement)).getAllByRole("row")
    ).toHaveLength(20)
    await userEvent.click(members.getByRole("button", { name: "Next page" }))
    await waitFor(async () =>
      expect(
        within(await memberBody(canvasElement)).getAllByRole("row")
      ).toHaveLength(5)
    )
    await userEvent.type(
      canvas.getByRole("textbox", { name: "Search members…" }),
      "Casey"
    )
    await userEvent.keyboard("{Enter}")
    await canvas.findByText("Casey Reader")
    await expect(
      within(await memberBody(canvasElement)).getAllByRole("row")
    ).toHaveLength(1)
    await expect(
      members.getByRole("button", { name: "Previous page" })
    ).toHaveAttribute("aria-disabled", "true")
  },
}
export const CustomRoleFromURL: Story = {
  args: { search: "?role=project-editor" },
  play: async ({ canvasElement }) => {
    await row(canvasElement, "Devon Editor")
    const toolbar = canvasElement.querySelector<HTMLElement>(
      '[data-slot="data-table-toolbar"]'
    )!
    await expect(
      within(toolbar).getByRole("button", { name: /^Role/ })
    ).toHaveTextContent("project-editor")
    await expect(
      within(await memberBody(canvasElement)).getAllByRole("row")
    ).toHaveLength(1)
  },
}
export const RoleWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, popup } = await selectRole(canvasElement)
    content.getByRole("button", { name: "Save" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(
      (await row(canvasElement)).getByText("project-editor")
    ).toBeVisible()
    await expect(
      within(canvasElement)
        .getByRole("heading", { name: "Members" })
        .closest('[tabindex="-1"]')!
    ).toHaveFocus()
  },
}
export const RoleSaving: Story = {
  ...scenario("saveLoading"),
  play: async ({ canvasElement }) => {
    const { content } = await selectRole(canvasElement)
    await userEvent.click(content.getByRole("button", { name: "Save" }))
    await expect(
      await content.findByRole("button", { name: "Submitting…" })
    ).toBeDisabled()
    await expect(content.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(content.getByRole("combobox")).toBeVisible()
  },
}
const retryRole: Story["play"] = async ({ canvasElement }) => {
  const { content, popup } = await selectRole(canvasElement)
  await userEvent.click(content.getByRole("button", { name: "Save" }))
  await content.findByRole("alert")
  await expect(content.getByRole("combobox")).toHaveTextContent(
    "project-editor"
  )
  await userEvent.click(content.getByRole("button", { name: "Save" }))
  await closed(popup)
  await expect(
    (await row(canvasElement)).getByText("project-editor")
  ).toBeVisible()
}
export const RoleSaveUnavailable: Story = {
  ...scenario("saveUnavailable"),
  play: retryRole,
}
export const RoleRateLimited: Story = {
  ...scenario("rateLimited"),
  play: retryRole,
}
export const RoleStaleVersion: Story = {
  ...scenario("stale"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await selectRole(canvasElement)
    await userEvent.click(content.getByRole("button", { name: "Save" }))
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "Member permissions have changed."
    )
    await expect(content.getByRole("combobox")).toHaveTextContent(
      "project-editor"
    )
    await expect(content.getByRole("button", { name: "Save" })).toBeDisabled()
    await userEvent.click(content.getByRole("button", { name: "Cancel" }))
    await closed(popup)
    const reopened = await selectRole(canvasElement)
    await userEvent.click(
      reopened.content.getByRole("button", { name: "Save" })
    )
    await closed(reopened.popup)
    await expect(
      (await row(canvasElement)).getByText("project-editor")
    ).toBeVisible()
  },
}
export const RolePermissionRevoked: Story = {
  ...scenario("saveForbidden"),
  play: async ({ canvasElement }) => {
    const { content } = await selectRole(canvasElement)
    await userEvent.click(content.getByRole("button", { name: "Save" }))
    await content.findByRole("alert")
    await waitFor(() =>
      expect(within(canvasElement).queryByText("Casey Reader")).toBeNull()
    )
  },
}
export const RoleSessionExpired: Story = {
  ...scenario("saveUnauthorized"),
  play: async ({ canvasElement }) => {
    const { content } = await selectRole(canvasElement)
    await userEvent.click(content.getByRole("button", { name: "Save" }))
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "Authentication required"
    )
    await expect(content.getByRole("combobox")).toHaveTextContent(
      "project-editor"
    )
  },
}
export const LastOwnerDemotion: Story = {
  ...scenario("lastOwner"),
  play: async ({ canvasElement }) => {
    const { content } = await selectRole(
      canvasElement,
      "Member",
      "Morgan Owner"
    )
    await userEvent.click(content.getByRole("button", { name: "Save" }))
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "The organization must retain at least one owner."
    )
    await expect(
      (await row(canvasElement, "Morgan Owner")).getByText("Owner", {
        exact: true,
      })
    ).toBeVisible()
  },
}
export const RemoveWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, popup } = await dialog(canvasElement, "remove")
    content.getByRole("button", { name: "Remove member" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(within(canvasElement).queryByText("Casey Reader")).toBeNull()
    await expect(
      within(canvasElement)
        .getByRole("heading", { name: "Members" })
        .closest('[tabindex="-1"]')!
    ).toHaveFocus()
  },
}
export const RemoveSaving: Story = {
  ...scenario("saveLoading"),
  play: async ({ canvasElement }) => {
    const { content } = await dialog(canvasElement, "remove")
    await userEvent.click(
      content.getByRole("button", { name: "Remove member" })
    )
    await expect(
      await content.findByRole("button", { name: "Submitting…" })
    ).toBeDisabled()
  },
}
export const RemoveUnavailable: Story = {
  ...scenario("saveUnavailable"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await dialog(canvasElement, "remove")
    await userEvent.click(
      content.getByRole("button", { name: "Remove member" })
    )
    await content.findByRole("alert")
    await row(canvasElement)
    await userEvent.click(
      content.getByRole("button", { name: "Remove member" })
    )
    await closed(popup)
    await expect(within(canvasElement).queryByText("Casey Reader")).toBeNull()
  },
}
export const LeaveDialogWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { popup, trigger } = await dialog(canvasElement, "leave")
    await userEvent.keyboard("{Escape}")
    await closed(popup)
    await expect(trigger).toHaveFocus()
  },
}
export const LeaveLastOwner: Story = {
  ...scenario("lastOwner"),
  play: async ({ canvasElement }) => {
    const { content } = await dialog(canvasElement, "leave")
    await userEvent.click(
      content.getByRole("button", { name: "Leave organization" })
    )
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "The organization must retain at least one owner."
    )
  },
}
export const DelegatedMemberUpdate: Story = {
  ...scenario("delegated"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await selectRole(
      canvasElement,
      "Member",
      "Devon Editor"
    )
    await userEvent.click(content.getByRole("button", { name: "Save" }))
    await closed(popup)
    await expect(
      (await row(canvasElement, "Devon Editor")).getByText("Member", {
        exact: true,
      })
    ).toBeVisible()
  },
}
export const DelegatedMemberRemoval: Story = {
  ...scenario("delegated"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await dialog(canvasElement, "remove")
    await userEvent.click(
      content.getByRole("button", { name: "Remove member" })
    )
    await closed(popup)
    await expect(within(canvasElement).queryByText("Casey Reader")).toBeNull()
    for (const name of ["Blair Admin", "Owen Owner"])
      await expect(
        (await row(canvasElement, name)).queryByRole("button")
      ).toBeNull()
  },
}
export const UpdateOnly: Story = {
  ...scenario("updateOnly"),
  play: async ({ canvasElement }) => {
    const target = await row(canvasElement)
    await expect(
      await target.findByRole("button", { name: "Change role" })
    ).toBeEnabled()
    await expect(
      target.queryByRole("button", { name: "Remove member" })
    ).toBeNull()
  },
}
export const DeleteOnly: Story = {
  ...scenario("deleteOnly"),
  play: async ({ canvasElement }) => {
    const target = await row(canvasElement)
    await expect(
      await target.findByRole("button", { name: "Remove member" })
    ).toBeEnabled()
    await expect(
      target.queryByRole("button", { name: "Change role" })
    ).toBeNull()
  },
}
export const PermissionLookupUnavailable: Story = {
  ...scenario("permissionUnavailable"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("alert")
    ).toHaveTextContent("Member permissions unavailable")
    await expect((await row(canvasElement)).queryByRole("button")).toBeNull()
  },
}
export const RoleDirectoryLoading: Story = {
  ...scenario("rolesLoading"),
  play: async ({ canvasElement }) => {
    const { content } = await dialog(canvasElement)
    await expect(await content.findByRole("status")).toHaveTextContent(
      "Loading…"
    )
    await expect(content.getByRole("combobox")).toHaveTextContent("Member")
  },
}
export const RoleDirectoryUnavailable: Story = {
  ...scenario("rolesUnavailable"),
  play: async ({ canvasElement }) => {
    const { content } = await dialog(canvasElement)
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "Role directory unavailable"
    )
    await expect(content.getByRole("combobox")).toHaveTextContent("Member")
  },
}
