import { AuthenticatedSessionProvider } from "@workspace/admin/auth"
import { authClient } from "@/lib/auth-client"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { createProjectHandler, organizations } from "@workspace/mocks"
import {
  createProjectAttachmentsScenario,
  personalAvatarUser,
} from "@workspace/mocks"
import { ProjectCreate } from "./project-create"

const meta = {
  decorators: [
    (Story) => (
      <AuthenticatedSessionProvider
        client={authClient}
        user={personalAvatarUser}
      >
        <Story />
      </AuthenticatedSessionProvider>
    ),
  ],
  title: "Admin/Project create",
  component: ProjectCreate,
  args: { organizationId: organizations[0].id },
  parameters: {
    msw: {
      handlers: {
        attachments: createProjectAttachmentsScenario().handlers,
        create: [createProjectHandler()],
      },
    },
  },
} satisfies Meta<typeof ProjectCreate>
export default meta
type Story = StoryObj<typeof meta>

async function openDialog(canvasElement: HTMLElement) {
  const screen = within(canvasElement.ownerDocument.body)
  await userEvent.click(within(canvasElement).getByRole("button"))
  const popup = await screen.findByRole("dialog")
  // 角色查询只保证已经挂载；入场动画结束后再开始表单操作。
  await waitFor(() => expect(popup).toBeVisible())
  await Promise.all(
    popup.getAnimations().map((animation) => animation.finished)
  )
  return { screen, popup, dialog: within(popup) }
}

export const Success: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { screen, dialog } = await openDialog(canvasElement)
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
  parameters: {
    msw: { handlers: { create: [createProjectHandler("error")] } },
  },
  play: async ({ canvasElement }) => {
    const { dialog } = await openDialog(canvasElement)
    await userEvent.type(dialog.getByLabelText("项目名称"), "Keep draft")
    await userEvent.click(dialog.getByRole("button", { name: "创建项目" }))
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "操作未成功"
    )
    await expect(dialog.getByLabelText("项目名称")).toHaveValue("Keep draft")
  },
}
export const Pending: Story = {
  parameters: {
    msw: { handlers: { create: [createProjectHandler("pending")] } },
  },
  play: async ({ canvasElement }) => {
    const { screen, dialog } = await openDialog(canvasElement)
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
    const { popup: dialog } = await openDialog(canvasElement)
    await expect(getComputedStyle(dialog).direction).toBe("rtl")
    await expect(dialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
    await expect(dialog.getBoundingClientRect().right).toBeLessThanOrEqual(
      window.innerWidth
    )
  },
}
