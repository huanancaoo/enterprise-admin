import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createPlatformEmployeesRolesScenario,
  createWorkspaceSessionHandlers,
  type PlatformEmployeesRolesScenario,
} from "@workspace/mocks"
import { EmployeeRoleStory } from "./employees-roles.story-fixture"

const scenario = (name: PlatformEmployeesRolesScenario = "success") => {
  const fixture = createPlatformEmployeesRolesScenario(name)
  return {
    beforeEach: fixture.reset,
    parameters: {
      layout: "fullscreen",
      msw: {
        handlers: [...fixture.handlers, ...createWorkspaceSessionHandlers()],
      },
    },
  }
}
const meta = {
  title: "Platform/System/Roles",
  component: EmployeeRoleStory,
  args: { page: "roles" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof EmployeeRoleStory>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Support")
    await expect(
      canvas.getByRole("combobox", { name: "Status" })
    ).toHaveTextContent("All statuses")
  },
}
export const Create: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Create role" })
    )
    const screen = within(canvasElement.ownerDocument.body)
    const dialog = within(await screen.findByRole("dialog"))
    await expect(
      dialog.getByRole("combobox", { name: "Status" })
    ).toHaveTextContent("Active")
    await waitFor(() =>
      expect(screen.getByLabelText("Role name")).toBeVisible()
    )
  },
}
export const Permissions: Story = {
  args: { page: "role-permissions" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", {
      name: "Save permissions",
    })
  },
}
export const Employees: Story = {
  args: { page: "role-employees" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("link", { name: "Mina Chen" })
    await userEvent.click(
      canvas.getByRole("tab", { name: "Unassigned employees" })
    )
    await canvas.findByRole("link", { name: "Operator 2" })
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No data yet")
  },
}
export const Loading: Story = { ...scenario("loading") }
export const Error: Story = {
  ...scenario("unavailable"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", { name: "Retry" })
  },
}
export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Support")
    await expect(
      canvas.queryByRole("button", { name: "Create role" })
    ).toBeNull()
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("combobox", { name: "状态" })
    ).toHaveTextContent("全部状态")
  },
}
export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("combobox", { name: "الحالة" })
    ).toHaveTextContent("جميع الحالات")
  },
}

export const ReadOnlyPermissions: Story = {
  args: { page: "role-permissions", readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("heading", { name: "Role permissions" })
    await expect(
      canvas.queryByRole("button", { name: "Save permissions" })
    ).toBeNull()
    await expect(
      canvas.queryByRole("link", { name: "Employee assignments" })
    ).toBeNull()
  },
}
