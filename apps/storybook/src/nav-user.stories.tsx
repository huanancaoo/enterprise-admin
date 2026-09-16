import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { NavUser } from "@workspace/admin"
import { SidebarProvider } from "@workspace/ui/components/sidebar"

const meta = {
  title: "Admin/Nav user",
  component: NavUser,
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="w-72 bg-sidebar p-2 text-sidebar-foreground">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { a11y: { test: "error" } },
  args: {
    user: {
      name: "测试用户",
      email: "user@example.com",
    },
    signingOut: false,
    onSignOut: () => undefined,
  },
} satisfies Meta<typeof NavUser>

export default meta
type Story = StoryObj<typeof meta>

export const LanguageMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole("button", { name: /测试用户/ }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "语言" }))
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "English" })
    )

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("lang", "en-US")
    )
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )

    await userEvent.click(canvas.getByRole("button", { name: /测试用户/ }))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Language" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "简体中文" })
    )
    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("lang", "zh-CN")
    )
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )
  },
}
