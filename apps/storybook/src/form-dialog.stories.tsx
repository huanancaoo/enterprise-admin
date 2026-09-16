import { PermissionGate, PermissionDeniedState } from "@workspace/admin"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { FormDialogExample } from "./form-dialog-example"

const meta = {
  title: "Admin/FormDialog",
  component: FormDialogExample,
} satisfies Meta<typeof FormDialogExample>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "创建项目" }))
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(dialog.getByLabelText("项目名称"), "   ")
    await userEvent.click(dialog.getByRole("button", { name: "保存" }))
    await expect(await dialog.findByText("请输入项目名称。")).toBeVisible()
    await userEvent.clear(dialog.getByLabelText("项目名称"))
    await userEvent.type(dialog.getByLabelText("项目名称"), "New project")
    await userEvent.click(dialog.getByRole("button", { name: "保存" }))
    await expect(dialog.getByRole("button", { name: "提交中…" })).toBeDisabled()
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(canvas.getByRole("button", { name: "创建项目" }))
    await expect(await screen.findByLabelText("项目名称")).toHaveValue("")
    await userEvent.keyboard("{Escape}")
  },
}
export const Error: Story = {
  args: { fail: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "创建项目" }))
    await userEvent.type(
      await screen.findByLabelText("项目名称"),
      "Keep my draft"
    )
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "操作未成功"
    )
    await expect(screen.getByLabelText("项目名称")).toHaveValue("Keep my draft")
    await userEvent.keyboard("{Escape}")
  },
}
export const RTL: Story = {
  args: { initiallyOpen: true },
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = await screen.findByRole("dialog")
    await expect(getComputedStyle(dialog).direction).toBe("rtl")
    const bounds = dialog.getBoundingClientRect()
    await expect(bounds.left).toBeGreaterThanOrEqual(0)
    await expect(bounds.right).toBeLessThanOrEqual(window.innerWidth)
    await userEvent.keyboard("{Escape}")
  },
}

export const Loading: Story = {
  args: { initiallyOpen: true, busy: true },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await expect(
      await screen.findByRole("button", { name: "提交中…" })
    ).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(screen.getByRole("dialog")).toBeInTheDocument()
  },
}
export const Empty: Story = {
  args: { initiallyOpen: true },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement.ownerDocument.body).findByLabelText("项目名称")
    ).toHaveValue("")
    await userEvent.keyboard("{Escape}")
  },
}
export const LongText: Story = {
  args: { initiallyOpen: true, longTitle: true },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole(
      "dialog"
    )
    await expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
    await userEvent.keyboard("{Escape}")
  },
}
export const PermissionDenied: Story = {
  render: () => (
    <PermissionGate allowed={false} denied={<PermissionDeniedState />}>
      <FormDialogExample />
    </PermissionGate>
  ),
}
