import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { TeamSwitcher } from "@workspace/admin"
import { SidebarProvider } from "@workspace/ui/components/sidebar"

const teams = [
  { id: "north", name: "北区组织" },
  { id: "south", name: "南区组织" },
]

const meta = {
  title: "Admin/Team switcher",
  component: TeamSwitcher,
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-h-96 w-[32rem] bg-sidebar p-2 text-sidebar-foreground">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: { a11y: { test: "error" } },
} satisfies Meta<typeof TeamSwitcher>

export default meta
type Story = StoryObj<typeof meta>

export const UnselectedWithTeams: Story = {
  args: {
    teams,
    value: null,
    label: "选择组织",
    onSelect: () => undefined,
  },
  render: function UnselectedWithTeamsStory(args) {
    const [value, setValue] = useState<string | null>(args.value)
    return <TeamSwitcher {...args} value={value} onSelect={setValue} />
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: /选择组织/ }))
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /北区组织/ })
    )
    await waitFor(() =>
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    )
    await expect(canvas.getByRole("button", { name: /北区组织/ })).toBeVisible()
  },
}

export const EmptyTeams: Story = {
  args: {
    teams: [],
    value: null,
    label: "选择组织",
    onSelect: () => undefined,
  },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", {
      name: /选择组织/,
    })
    await expect(button).toBeDisabled()
  },
}

export const CreateTeam: Story = {
  args: {
    teams,
    value: "north",
    label: "选择组织",
    createLabel: "创建组织",
    onSelect: () => undefined,
    onCreate: () => undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("button", { name: /北区组织/ }))
    await screen.findByRole("menuitem", { name: /创建组织/ })
    await userEvent.keyboard("{Escape}")
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    )
  },
}
