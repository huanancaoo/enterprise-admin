import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createInvitationsScenario,
  longInvitationEmail,
  type InvitationsScenario,
} from "@workspace/mocks"
import { InvitationsStory } from "./invitations.story-fixture"

const scenario = (name: InvitationsScenario = "success") => {
  const fixture = createInvitationsScenario(name)
  return {
    args: { actorRole: fixture.actorRole },
    beforeEach: fixture.reset,
    parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
  }
}
const meta = {
  title: "Admin/Invitations",
  component: InvitationsStory,
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof InvitationsStory>
export default meta
type Story = StoryObj<typeof meta>
const newEmail = "new.member@example.test"
async function directory(canvasElement: HTMLElement) {
  return within(canvasElement).findByRole("list", {
    name: "Invitations",
    hidden: true,
  })
}
async function row(canvasElement: HTMLElement, email = "casey@example.test") {
  const list = await directory(canvasElement)
  return within((await within(list).findByText(email)).closest("li")!)
}
async function invite(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  const trigger = await canvas.findByRole("button", { name: "Invite member" })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  const screen = within(canvasElement.ownerDocument.body)
  const popup = await screen.findByRole("dialog")
  const content = within(popup)
  const email = content.getByRole("textbox", { name: "Email" })
  await waitFor(() => expect(email).toHaveFocus())
  return { canvas, screen, popup, content, email, trigger }
}
async function filled(canvasElement: HTMLElement) {
  const result = await invite(canvasElement)
  await userEvent.type(result.email, newEmail)
  return result
}
async function closed(popup: HTMLElement) {
  await waitFor(() => expect(popup).not.toBeInTheDocument())
}
async function chooseRole(
  content: ReturnType<typeof within>,
  screen: ReturnType<typeof within>,
  name: string
) {
  const control = content.getByRole("combobox", { name: "Role" })
  control.focus()
  await userEvent.keyboard("{Enter}")
  const option = await screen.findByRole("option", { name })
  const list = screen.getByRole("listbox")
  option.focus()
  await userEvent.keyboard("{Enter}")
  await waitFor(() => expect(list).not.toBeVisible())
}
async function cancelDialog(canvasElement: HTMLElement, email?: string) {
  const trigger = await (
    await row(canvasElement, email)
  ).findByRole("button", {
    name: "Cancel invitation",
  })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  const popup = await within(canvasElement.ownerDocument.body).findByRole(
    "alertdialog"
  )
  return { popup, content: within(popup), trigger }
}
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const list = await directory(canvasElement)
    await expect(within(list).getAllByRole("listitem")).toHaveLength(3)
    await expect(
      (await row(canvasElement)).getByText("Accepted by SMTP", { exact: false })
    ).toBeVisible()
  },
}
export const PermissionLoading: Story = {
  ...scenario("permissionLoading"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveTextContent("Loading…")
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Invitations" })
    await expect(canvas.getByRole("status")).toHaveTextContent("Loading…")
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No invitations.")
  },
}
const readError: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await canvas.findByRole("alert")
  await expect(canvas.queryByRole("list", { name: "Invitations" })).toBeNull()
}
export const Error: Story = { ...scenario("unavailable"), play: readError }
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: readError,
}
export const PermissionLookupUnavailable: Story = {
  ...scenario("permissionUnavailable"),
  play: readError,
}
export const PermissionRevoked: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Invitations" })
    await waitFor(() =>
      expect(canvas.queryByRole("heading", { name: "Invitations" })).toBeNull()
    )
    await expect(canvas.queryByRole("list")).toBeNull()
  },
}
export const MemberWithoutActions: Story = {
  ...scenario("member"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("status")
    await waitFor(() => expect(canvas.queryByRole("status")).toBeNull())
    await expect(canvas.queryByRole("heading")).toBeNull()
    await expect(canvas.queryByRole("button")).toBeNull()
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("status")
    await directory(canvasElement)
  },
}
export const LongText: Story = {
  ...scenario("longText"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(longInvitationEmail)
    const html = canvasElement.ownerDocument.documentElement
    await expect(html.scrollWidth).toBe(html.clientWidth)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("list", { name: "الدعوات" })
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("list", { name: "邀请" })
  },
}
export const TerminalStatuses: Story = {
  ...scenario("terminal"),
  play: async ({ canvasElement }) => {
    const list = await directory(canvasElement)
    for (const text of ["Accepted", "Rejected", "Canceled", "Expired"])
      await expect(within(list).getByText(new RegExp(text))).toBeVisible()
    await expect(within(list).queryAllByRole("button")).toHaveLength(0)
  },
}
export const AdminCannotManageAdminInvitation: Story = {
  ...scenario("admin"),
  play: async ({ canvasElement }) => {
    await row(canvasElement)
    await expect(
      (await row(canvasElement, "blair@example.test")).queryAllByRole("button")
    ).toHaveLength(0)
    const { content, screen } = await invite(canvasElement)
    await userEvent.click(content.getByRole("combobox", { name: "Role" }))
    await screen.findByRole("option", { name: "Member" })
    await expect(screen.queryByRole("option", { name: "Admin" })).toBeNull()
    await expect(screen.queryByRole("option", { name: "Owner" })).toBeNull()
  },
}
export const OwnerCanInviteAdmin: Story = {
  play: async ({ canvasElement }) => {
    const { content, screen } = await filled(canvasElement)
    await chooseRole(content, screen, "Admin")
    await expect(content.getByRole("combobox")).toHaveTextContent("Admin")
  },
}
export const CreateOnly: Story = {
  ...scenario("createOnly"),
  play: async ({ canvasElement }) => {
    const target = await row(canvasElement)
    await expect(target.getByRole("button", { name: "Resend" })).toBeEnabled()
    await expect(
      target.queryByRole("button", { name: "Cancel invitation" })
    ).toBeNull()
  },
}
export const CancelOnly: Story = {
  ...scenario("cancelOnly"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await row(canvasElement)
    await expect(
      canvas.queryByRole("button", { name: "Invite member" })
    ).toBeNull()
    await expect(
      (await row(canvasElement)).queryByRole("button", { name: "Resend" })
    ).toBeNull()
    await expect(
      (await row(canvasElement)).getByRole("button", {
        name: "Cancel invitation",
      })
    ).toBeEnabled()
  },
}
export const RoleDirectoryLoading: Story = {
  ...scenario("rolesLoading"),
  play: async ({ canvasElement }) => {
    const { content } = await invite(canvasElement)
    await expect(await content.findByRole("status")).toHaveTextContent(
      "Loading…"
    )
    await expect(content.getByRole("combobox")).toHaveTextContent("Member")
  },
}
export const RoleDirectoryUnavailable: Story = {
  ...scenario("rolesUnavailable"),
  play: async ({ canvasElement }) => {
    const { content } = await invite(canvasElement)
    await expect(await content.findByRole("alert")).toHaveTextContent(
      "Role directory unavailable"
    )
    await expect(content.getByRole("combobox")).toHaveTextContent("Member")
  },
}
export const InviteWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, screen, popup, trigger } = await filled(canvasElement)
    await chooseRole(content, screen, "project-editor")
    content.getByRole("button", { name: "Send invitation" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(
      (await row(canvasElement, newEmail)).getByText(/project-editor/)
    ).toBeVisible()
    await expect(trigger).toHaveFocus()
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveTextContent("Invitation created. Accepted by SMTP")
  },
}
export const DelegatedCustomRole: Story = {
  ...scenario("delegated"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await filled(canvasElement)
    const role = content.getByRole("textbox", { name: "Role" })
    await userEvent.clear(role)
    await userEvent.type(role, "project-editor")
    await userEvent.click(
      content.getByRole("button", { name: "Send invitation" })
    )
    await closed(popup)
    await expect(
      (await row(canvasElement, newEmail)).getByText(/project-editor/)
    ).toBeVisible()
    await expect(
      (await row(canvasElement, "blair@example.test")).queryAllByRole("button")
    ).toHaveLength(0)
  },
}
export const InvalidEmail: Story = {
  play: async ({ canvasElement }) => {
    const { content, email } = await invite(canvasElement)
    await userEvent.type(email, "invalid-email")
    await userEvent.click(
      content.getByRole("button", { name: "Send invitation" })
    )
    await expect(email).toBeInvalid()
    await expect(email).toHaveValue("invalid-email")
    await expect(
      content.getByRole("button", { name: "Send invitation" })
    ).toBeEnabled()
  },
}
export const EmptyDelegatedRole: Story = {
  ...scenario("delegated"),
  play: async ({ canvasElement }) => {
    const { content } = await filled(canvasElement)
    const role = content.getByRole("textbox", { name: "Role" })
    await userEvent.clear(role)
    await userEvent.click(
      content.getByRole("button", { name: "Send invitation" })
    )
    await expect(role).toBeInvalid()
  },
}
export const InviteSaving: Story = {
  ...scenario("saveLoading"),
  play: async ({ canvasElement }) => {
    const { content, email, popup } = await filled(canvasElement)
    await userEvent.click(
      content.getByRole("button", { name: "Send invitation" })
    )
    await expect(
      await content.findByRole("button", { name: "Submitting…" })
    ).toBeDisabled()
    await expect(email).toBeDisabled()
    await expect(content.getByRole("combobox")).toBeDisabled()
    await expect(content.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(popup).toBeVisible()
  },
}
const inviteRetry: Story["play"] = async ({ canvasElement }) => {
  const { content, email, popup } = await filled(canvasElement)
  const submit = content.getByRole("button", { name: "Send invitation" })
  await userEvent.click(submit)
  await content.findByRole("alert")
  await expect(email).toHaveValue(newEmail)
  await waitFor(() => expect(submit).toBeEnabled())
  await userEvent.click(submit)
  await closed(popup)
  await row(canvasElement, newEmail)
}
export const InviteUnavailable: Story = {
  ...scenario("saveUnavailable"),
  play: inviteRetry,
}
export const InviteRateLimited: Story = {
  ...scenario("rateLimited"),
  play: inviteRetry,
}
const inviteRejected: Story["play"] = async ({ canvasElement }) => {
  const { content, email } = await filled(canvasElement)
  await userEvent.click(
    content.getByRole("button", { name: "Send invitation" })
  )
  await content.findByRole("alert")
  await expect(email).toHaveValue(newEmail)
  await waitFor(() =>
    expect(
      content.getByRole("button", { name: "Send invitation" })
    ).toBeEnabled()
  )
}
export const InvitePermissionDenied: Story = {
  ...scenario("saveForbidden"),
  play: inviteRejected,
}
export const InviteSessionExpired: Story = {
  ...scenario("saveUnauthorized"),
  play: inviteRejected,
}
const inviteConflict =
  (email: string, message: string): Story["play"] =>
  async ({ canvasElement }) => {
    const result = await invite(canvasElement)
    await userEvent.type(result.email, email)
    await userEvent.click(
      result.content.getByRole("button", { name: "Send invitation" })
    )
    await expect(await result.content.findByRole("alert")).toHaveTextContent(
      message
    )
    await expect(result.email).toHaveValue(email)
    await waitFor(() =>
      expect(
        result.content.getByRole("button", { name: "Send invitation" })
      ).toBeEnabled()
    )
    await expect(
      within(await directory(canvasElement)).getAllByRole("listitem", {
        hidden: true,
      })
    ).toHaveLength(3)
  }
export const InviteAlreadyPending: Story = {
  ...scenario("alreadyPending"),
  play: inviteConflict(
    "casey@example.test",
    "This email has an active invitation. Resend the existing invitation."
  ),
}
export const InviteAlreadyMember: Story = {
  ...scenario("alreadyMember"),
  play: inviteConflict(
    newEmail,
    "This email is already an organization member."
  ),
}
const deliveryNotice =
  (text: string, alert = false): Story["play"] =>
  async ({ canvasElement }) => {
    const { content, popup } = await filled(canvasElement)
    await userEvent.click(
      content.getByRole("button", { name: "Send invitation" })
    )
    await closed(popup)
    await expect(
      await within(canvasElement).findByRole(alert ? "alert" : "status")
    ).toHaveTextContent(`Invitation created. ${text}`)
    const target = await row(canvasElement, newEmail)
    await expect(target.getByText(/Member · Pending/)).toBeVisible()
    await expect(target.getByText(new RegExp(text))).toBeVisible()
  }
export const FailedDelivery: Story = {
  ...scenario("failedDelivery"),
  play: deliveryNotice("Mail send failed", true),
}
export const UnknownDelivery: Story = {
  ...scenario("unknownDelivery"),
  play: deliveryNotice("Mail delivery result unknown", true),
}
export const PendingDelivery: Story = {
  ...scenario("pendingDelivery"),
  play: deliveryNotice("Mail awaiting send"),
}
export const UnrecordedDelivery: Story = {
  ...scenario("unrecordedDelivery"),
  play: deliveryNotice("No delivery result recorded"),
}
export const ReadBackUnavailable: Story = {
  ...scenario("readBackUnavailable"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await filled(canvasElement)
    await userEvent.click(
      content.getByRole("button", { name: "Send invitation" })
    )
    await closed(popup)
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Invitation created. No delivery result recorded"
    )
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Invitation directory unavailable"
    )
    await expect(canvas.queryByRole("list")).toBeNull()
  },
}
export const CloseDraftWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { popup, trigger } = await filled(canvasElement)
    await userEvent.keyboard("{Escape}")
    await closed(popup)
    await expect(trigger).toHaveFocus()
    const reopened = await invite(canvasElement)
    await expect(reopened.email).toHaveValue(newEmail)
  },
}
export const ResendWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const target = await row(canvasElement)
    const dates = target
      .getAllByRole("time")
      .map((element) => element.getAttribute("datetime"))
    const trigger = target.getByRole("button", { name: "Resend" })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(within(canvasElement).getByRole("status")).toHaveTextContent(
        "Resend attempted. Accepted by SMTP"
      )
    )
    await expect(
      target
        .getAllByRole("time")
        .map((element) => element.getAttribute("datetime"))
    ).toEqual(dates)
    await expect(
      within(await directory(canvasElement)).getAllByRole("listitem")
    ).toHaveLength(3)
    await expect(trigger).toBeInTheDocument()
    await waitFor(() => expect(trigger).toBeEnabled())
    await expect(trigger).toHaveFocus()
  },
}
export const ResendSaving: Story = {
  ...scenario("saveLoading"),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      (await row(canvasElement)).getByRole("button", { name: "Resend" })
    )
    await waitFor(() => {
      for (const button of within(canvasElement).getAllByRole("button", {
        name: "Resend",
      }))
        expect(button).toBeDisabled()
    })
  },
}
export const ResendKeepsNewFocus: Story = {
  play: async ({ canvasElement }) => {
    const trigger = (await row(canvasElement)).getByRole("button", {
      name: "Resend",
    })
    trigger.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(trigger).toBeDisabled())
    const next = within(canvasElement).getByRole("button", {
      name: "Invite member",
    })
    next.focus()
    await waitFor(() => expect(trigger).toBeEnabled())
    await expect(next).toHaveFocus()
  },
}
const resendFailure: Story["play"] = async ({ canvasElement }) => {
  const target = await row(canvasElement)
  const trigger = target.getByRole("button", { name: "Resend" })
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  await within(canvasElement).findByRole("alert")
  await waitFor(() => expect(trigger).toBeEnabled())
  await expect(trigger).toHaveFocus()
  await expect(target.getByText(/Member · Pending/)).toBeVisible()
  await expect(
    within(await directory(canvasElement)).getAllByRole("listitem")
  ).toHaveLength(3)
}
export const ResendUnavailable: Story = {
  ...scenario("saveUnavailable"),
  play: resendFailure,
}
export const ResendRateLimited: Story = {
  ...scenario("rateLimited"),
  play: resendFailure,
}
export const CancelWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { content, popup } = await cancelDialog(canvasElement)
    content.getByRole("button", { name: "Cancel invitation" }).focus()
    await userEvent.keyboard("{Enter}")
    await closed(popup)
    await expect(
      (await row(canvasElement)).getByText(/Member · Canceled/)
    ).toBeVisible()
    await expect(
      (await row(canvasElement)).queryAllByRole("button")
    ).toHaveLength(0)
    await expect(
      within(canvasElement).getByRole("heading", { name: "Invitations" })
    ).toHaveFocus()
  },
}
export const CloseCancelWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { popup, trigger } = await cancelDialog(canvasElement)
    await userEvent.keyboard("{Escape}")
    await closed(popup)
    await expect(trigger).toHaveFocus()
    await expect(
      (await row(canvasElement)).getByText(/Member · Pending/)
    ).toBeVisible()
  },
}
export const CancelSaving: Story = {
  ...scenario("cancelLoading"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await cancelDialog(canvasElement)
    await userEvent.click(
      content.getByRole("button", { name: "Cancel invitation" })
    )
    await expect(
      await content.findByRole("button", { name: "Cancelling…" })
    ).toBeDisabled()
    await expect(content.getByRole("button", { name: "Cancel" })).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(popup).toBeVisible()
  },
}
export const CancelUnavailable: Story = {
  ...scenario("cancelUnavailable"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await cancelDialog(canvasElement)
    const submit = content.getByRole("button", { name: "Cancel invitation" })
    await userEvent.click(submit)
    await content.findByRole("alert")
    await expect(
      (await row(canvasElement)).getByText(/Member · Pending/)
    ).toBeVisible()
    await waitFor(() => expect(submit).toBeEnabled())
    await userEvent.click(submit)
    await closed(popup)
    await expect(
      (await row(canvasElement)).getByText(/Member · Canceled/)
    ).toBeVisible()
  },
}
const cancelRejected: Story["play"] = async ({ canvasElement }) => {
  const { content } = await cancelDialog(canvasElement)
  await userEvent.click(
    content.getByRole("button", { name: "Cancel invitation" })
  )
  await content.findByRole("alert")
  await expect(
    (await row(canvasElement)).getByText(/Member · Pending/)
  ).toBeVisible()
}
export const CancelPermissionDenied: Story = {
  ...scenario("cancelForbidden"),
  play: cancelRejected,
}
export const CancelSessionExpired: Story = {
  ...scenario("cancelUnauthorized"),
  play: cancelRejected,
}
export const CancelErrorDoesNotFollowAnotherTarget: Story = {
  ...scenario("cancelUnavailable"),
  play: async ({ canvasElement }) => {
    const { content, popup } = await cancelDialog(canvasElement)
    await userEvent.click(
      content.getByRole("button", { name: "Cancel invitation" })
    )
    await content.findByRole("alert")
    await userEvent.click(content.getByRole("button", { name: "Cancel" }))
    await closed(popup)
    const next = await cancelDialog(canvasElement, "devon@example.test")
    await expect(next.content.queryByRole("alert")).toBeNull()
  },
}
