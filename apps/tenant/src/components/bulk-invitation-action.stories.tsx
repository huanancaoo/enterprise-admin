import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createBulkInvitationScenario,
  createInvitationsScenario,
} from "@workspace/mocks"
import { InvitationsStory } from "./invitations.story-fixture"

function scenario(name: "success" | "failure" | "pending" = "success") {
  const bulk = createBulkInvitationScenario(name)
  const invitation = createInvitationsScenario()
  return {
    bulk,
    story: {
      beforeEach: () => {
        bulk.reset()
        invitation.reset()
      },
      parameters: {
        layout: "fullscreen",
        msw: { handlers: [...bulk.handlers, ...invitation.handlers] },
      },
    },
  }
}
const defaults = scenario()
const meta = {
  title: "Admin/Bulk invitations",
  component: InvitationsStory,
  globals: { locale: "en-US" },
  ...defaults.story,
} satisfies Meta<typeof InvitationsStory>
export default meta
type Story = StoryObj<typeof meta>
async function open(canvasElement: HTMLElement) {
  await userEvent.click(
    await within(canvasElement).findByRole("button", { name: "Bulk invite" })
  )
  const popup = await within(canvasElement.ownerDocument.body).findByRole(
    "dialog"
  )
  return { popup, dialog: within(popup) }
}
async function upload(
  dialog: ReturnType<typeof within>,
  file = new File(["xlsx-test-bytes"], "invitations.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
) {
  const control = dialog.getByLabelText("Email Excel file")
  // 使用浏览器原生 FileList，确保 required 文件控件也通过 Chromium 的约束校验。
  const transfer = new DataTransfer()
  transfer.items.add(file)
  ;(control as HTMLInputElement).files = transfer.files
  control.dispatchEvent(new Event("change", { bubbles: true }))
  await waitFor(() =>
    expect((control as HTMLInputElement).files).toHaveLength(1)
  )
  return control
}
const submitted = scenario()
export const SubmitAndOpenTask: Story = {
  ...submitted.story,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    await upload(dialog)
    await userEvent.click(
      dialog.getByRole("button", { name: "Submit invitations" })
    )
    await expect(await dialog.findByRole("status")).toHaveTextContent(
      "was submitted"
    )
    await expect(submitted.bulk.submissions).toHaveLength(1)
    await expect(submitted.bulk.submissions[0]?.key).toMatch(/^[a-f0-9-]{36}$/)
    await userEvent.click(dialog.getByRole("button", { name: "View task" }))
    await expect(
      await within(canvasElement).findByRole("heading", { name: "Task center" })
    ).toBeVisible()
  },
}
const template = scenario()
export const DownloadTemplate: Story = {
  ...template.story,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    await userEvent.click(
      dialog.getByRole("button", { name: "Download Excel template" })
    )
    await waitFor(() => expect(template.bulk.downloads).toBe(1))
  },
}
export const OversizedFile: Story = {
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    const file = await upload(
      dialog,
      new File([new Uint8Array(2 * 1024 ** 2 + 1)], "large.xlsx")
    )
    await userEvent.click(
      dialog.getByRole("button", { name: "Submit invitations" })
    )
    await waitFor(() => expect(file).toHaveAttribute("aria-invalid", "true"))
    await expect(
      dialog.getByText("Choose a valid XLSX file up to 2 MiB.")
    ).toBeVisible()
  },
}
const failure = scenario("failure")
export const FailurePreservesFileAndIdempotency: Story = {
  ...failure.story,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    const input = await upload(dialog)
    await userEvent.click(
      dialog.getByRole("button", { name: "Submit invitations" })
    )
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Invitation task unavailable"
    )
    await expect((input as HTMLInputElement).files?.[0]?.name).toBe(
      "invitations.xlsx"
    )
    await userEvent.click(
      dialog.getByRole("button", { name: "Submit invitations" })
    )
    await waitFor(() => expect(failure.bulk.submissions).toHaveLength(2))
    await expect(failure.bulk.submissions[0]?.key).toBe(
      failure.bulk.submissions[1]?.key
    )
  },
}
export const PendingPreventsDuplicate: Story = {
  ...scenario("pending").story,
  play: async ({ canvasElement }) => {
    const { dialog } = await open(canvasElement)
    await upload(dialog)
    await userEvent.click(
      dialog.getByRole("button", { name: "Submit invitations" })
    )
    await waitFor(() =>
      expect(dialog.getByRole("button", { name: "Submitting…" })).toBeDisabled()
    )
    await expect(dialog.getByLabelText("Email Excel file")).toBeDisabled()
  },
}
export const NarrowArabic: Story = {
  globals: { locale: "ar", viewport: { value: "mobile1", isRotated: false } },
}
