import type { Meta, StoryObj } from "@storybook/react-vite"
import { fn, expect, userEvent, waitFor, within } from "storybook/test"
import {
  PlatformEmployeeImportAction,
  PlatformExportAction,
} from "./task-action-forms"

const meta = {
  title: "Platform/System/TaskActions",
  component: PlatformEmployeeImportAction,
  globals: { locale: "en-US" },
  args: {
    onSubmit: fn(async () => ({ id: "task-2" })),
    onDownloadTemplate: fn(),
    onOpenTask: fn(),
  },
} satisfies Meta<typeof PlatformEmployeeImportAction>
export default meta
type Story = StoryObj<typeof meta>
export const Import: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Import employees" })
    )
    const screen = within(canvasElement.ownerDocument.body)
    await screen.findByRole("dialog", { name: "Import employees" })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Download import template" })
      ).toBeVisible()
    )
    await expect(screen.getByLabelText("Initial password")).toHaveAttribute(
      "type",
      "password"
    )
    await expect(
      screen.getByRole("checkbox", { name: "Update existing employees" })
    ).not.toBeChecked()
  },
}
export const Arabic: Story = { globals: { locale: "ar" } }
export const Chinese: Story = { globals: { locale: "zh-CN" } }
export const Export: Story = {
  render: () => (
    <PlatformExportAction
      onSubmit={fn(async () => ({ id: "export-task" }))}
      onOpenTask={fn()}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Export" })
    )
    const screen = within(canvasElement.ownerDocument.body)
    await screen.findByRole("dialog", { name: "Export" })
    await userEvent.click(
      screen.getByRole("button", { name: "Submit export task" })
    )
    await screen.findByRole("button", { name: "View task" })
    await expect(screen.getByText("Task submitted.")).toBeVisible()
  },
}
