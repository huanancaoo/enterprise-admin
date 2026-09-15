import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within, userEvent } from "storybook/test"
import { Button } from "@workspace/ui/components/button"

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { a11y: { test: "error" } },
  args: { children: "按钮" },
} satisfies Meta<typeof Button>
export default meta
export const Default: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "按钮" })
    await userEvent.tab()
    await expect(button).toHaveFocus()
    await expect(button).toBeEnabled()
  },
}
