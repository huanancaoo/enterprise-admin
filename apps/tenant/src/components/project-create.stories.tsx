import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { createProjectHandler, organizations } from "@workspace/mocks"
import { ProjectCreate } from "./project-create"

const meta = {
  title: "Admin/Project create",
  component: ProjectCreate,
  args: { organizationId: organizations[0].id },
  parameters: { msw: { handlers: [createProjectHandler()] } },
} satisfies Meta<typeof ProjectCreate>
export default meta
type Story = StoryObj<typeof meta>

export const Success: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: "创建项目" }))
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(dialog.getByLabelText("项目名称"), "   ")
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await expect(await dialog.findByText("请输入项目名称。")).toBeVisible()
    await userEvent.clear(dialog.getByLabelText("项目名称"))
    await userEvent.type(dialog.getByLabelText("项目名称"), "Created project")
    await userEvent.type(dialog.getByLabelText("描述"), "Saved description")
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await expect(dialog.getByRole("button", { name: "提交中…" })).toBeDisabled()
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(canvas.getByRole("button", { name: "创建项目" }))
    await expect(await screen.findByLabelText("项目名称")).toHaveValue("")
    await expect(screen.getByLabelText("描述")).toHaveValue("")
  },
}
export const Failure: Story = {
  parameters: { msw: { handlers: [createProjectHandler("error")] } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "创建项目" })
    )
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(dialog.getByLabelText("项目名称"), "Keep draft")
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "操作未成功"
    )
    await expect(dialog.getByLabelText("项目名称")).toHaveValue("Keep draft")
  },
}
export const Pending: Story = {
  parameters: { msw: { handlers: [createProjectHandler("pending")] } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "创建项目" })
    )
    const dialog = within(await screen.findByRole("dialog"))
    await userEvent.type(dialog.getByLabelText("项目名称"), "Pending")
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await expect(dialog.getByRole("button", { name: "提交中…" })).toBeDisabled()
    await expect(dialog.getByLabelText("项目名称")).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(screen.getByRole("dialog")).toBeVisible()
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(within(canvasElement).getByRole("button"))
    const dialog = await screen.findByRole("dialog")
    await expect(getComputedStyle(dialog).direction).toBe("rtl")
    await expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    await expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(
      window.innerWidth
    )
  },
}
