import type { Meta, StoryObj } from "@storybook/react-vite"
import { useTranslation } from "react-i18next"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  createPlatformEmployeesRolesScenario,
  createWorkspaceSessionHandlers,
  platformEmployeeFixture,
  type PlatformEmployeesRolesScenario,
} from "@workspace/mocks"
import { EmployeeRoleStory } from "./employees-roles.story-fixture"
import { PlatformReadPageStory } from "../platform-read-page.story-fixture"

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
  title: "Platform/System/Employees",
  component: EmployeeRoleStory,
  args: { page: "employees" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof EmployeeRoleStory>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole("combobox", { name: "Employment status" })
    ).toHaveTextContent("All employment statuses")
    await userEvent.click(
      await canvas.findByRole("link", { name: "Mina Chen" })
    )
    await canvas.findByRole("heading", { name: "Mina Chen" })
    await expect((await canvas.findAllByText("Operations"))[0]).toBeVisible()
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("No data yet")
  },
}
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("status")
  },
}
export const Error: Story = {
  ...scenario("unavailable"),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", { name: "Retry" })
  },
}
export const Create: Story = {
  args: { page: "employee-create" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Create employee" })
    )
    await canvas.findByText("Enter a name between 1 and 200 characters.")
    await expect(canvas.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "true"
    )
  },
}
export const GrantExisting: Story = {
  args: { page: "employee-grant" },
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("button", {
        name: "Choose Existing global account",
      })
    )
    await within(canvasElement.ownerDocument.body).findByText("Jo Park")
  },
}
export const Locked: Story = {
  ...scenario("locked"),
  args: { page: "employee-detail" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("button", {
      name: "Unlock password login",
    })
  },
}

function UnlockUpdatesUserAndEmployeeFixture({
  args,
}: {
  args: Parameters<typeof EmployeeRoleStory>[0]
}) {
  const { t: employeeText } = useTranslation("employees")
  const { t: identityText } = useTranslation("identity")

  return (
    <main>
      <section aria-label={employeeText("profile")}>
        <EmployeeRoleStory {...args} embedded />
      </section>
      <section aria-label={identityText("user")}>
        <PlatformReadPageStory
          page="users"
          embedded
          initialEntry={`/platform/users/${platformEmployeeFixture.userId}`}
        />
      </section>
    </main>
  )
}

export const UnlockUpdatesUserAndEmployee: Story = {
  ...scenario("locked"),
  args: { page: "employee-detail" },
  render: (args) => <UnlockUpdatesUserAndEmployeeFixture args={args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const employee = within(
      canvas.getByRole("region", { name: "Employee profile" })
    )
    const user = within(canvas.getByRole("region", { name: "Account" }))
    await user.findByText("Locked")
    await expect(
      await employee.findByText("5", { selector: "dd" })
    ).toBeVisible()
    await userEvent.click(
      await employee.findByRole("button", { name: "Unlock password login" })
    )
    const dialogElement = await within(
      canvasElement.ownerDocument.body
    ).findByRole("dialog")
    const dialog = within(dialogElement)
    await userEvent.click(
      dialog.getByRole("button", { name: "Unlock password login" })
    )
    await employee.findByText("Not locked")
    await expect(employee.getByText("0", { selector: "dd" })).toBeVisible()
    await user.findByText("Not locked")
    await expect(user.queryByText("Locked")).toBeNull()
    await expect(
      employee.queryByRole("button", { name: "Unlock password login" })
    ).toBeNull()
    await waitFor(() => expect(dialogElement.isConnected).toBe(false))
    await expect(
      employee.getByRole("button", { name: "Disable employment" })
    ).toBeVisible()
  },
}

export const UserUnlockUpdatesEmployee: Story = {
  ...UnlockUpdatesUserAndEmployee,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const employee = within(
      canvas.getByRole("region", { name: "Employee profile" })
    )
    const user = within(canvas.getByRole("region", { name: "Account" }))
    await expect(
      await employee.findByText("5", { selector: "dd" })
    ).toBeVisible()
    await userEvent.click(
      await user.findByRole("button", { name: "Unlock password login" })
    )
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await userEvent.click(dialog.getByRole("button", { name: "Confirm" }))
    await user.findByText("Not locked")
    await employee.findByText("Not locked")
    await expect(employee.getByText("0", { selector: "dd" })).toBeVisible()
    await expect(
      employee.queryByRole("button", { name: "Unlock password login" })
    ).toBeNull()
    await expect(
      employee.getByRole("button", { name: "Disable employment" })
    ).toBeVisible()
  },
}

export const ClearPasswordFailuresWithoutLock: Story = {
  ...scenario("passwordFailures"),
  args: { page: "employee-detail" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("Not locked")
    await expect(canvas.getByText("2", { selector: "dd" })).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Unlock password login" })
    )
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await userEvent.click(
      dialog.getByRole("button", { name: "Unlock password login" })
    )
    await canvas.findByText("0", { selector: "dd" })
    await expect(
      canvas.queryByRole("button", { name: "Unlock password login" })
    ).toBeNull()
  },
}

export const UnlockFailureKeepsLock: Story = {
  ...scenario("unlockFailure"),
  args: { page: "employee-detail" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("button", { name: "Unlock password login" })
    )
    const dialog = within(
      await within(canvasElement.ownerDocument.body).findByRole("dialog")
    )
    await userEvent.click(
      dialog.getByRole("button", { name: "Unlock password login" })
    )
    await dialog.findByRole("alert")
    await expect(
      dialog.getByRole("button", { name: "Unlock password login" })
    ).toBeEnabled()
    await expect(canvas.getByText("5", { selector: "dd" })).toBeVisible()
    await expect(canvas.queryByText("Not locked")).toBeNull()
  },
}

export const ReadOnly: Story = {
  args: { readOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("link", { name: "Mina Chen" })
    await expect(
      canvas.queryByRole("button", { name: "Create employee" })
    ).toBeNull()
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("combobox", { name: "任职状态" })
    ).toHaveTextContent("全部任职状态")
  },
}
export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("combobox", {
        name: "حالة التوظيف",
      })
    ).toHaveTextContent("جميع حالات التوظيف")
  },
}

export const Pagination: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("link", { name: "Mina Chen" })
    await userEvent.click(canvas.getByRole("button", { name: "Next page" }))
    await canvas.findByRole("link", { name: "Operator 21" })
    await expect(canvas.queryByRole("link", { name: "Mina Chen" })).toBeNull()
  },
}

const employeeReadFixture =
  createPlatformEmployeesRolesScenario("withoutCatalogRead")
export const EmployeeReadWithoutCatalogPermissions: Story = {
  args: { page: "employees", employeeAccess: "read" },
  beforeEach: employeeReadFixture.reset,
  parameters: {
    msw: {
      handlers: [
        ...employeeReadFixture.handlers,
        ...createWorkspaceSessionHandlers(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole("link", { name: "Mina Chen" })
    )
    await canvas.findByRole("heading", { name: "Mina Chen" })
    await expect(canvas.getByText("Operations")).toBeVisible()
    await expect(canvas.getByText("Support specialist")).toBeVisible()
    await expect(canvas.getByText("Support")).toBeVisible()
    await expect(canvas.queryByRole("alert")).toBeNull()
    await expect(
      employeeReadFixture.requests.filter((request) =>
        /\/platform\/(departments|posts|roles)(?:\/|$)/.test(request.path)
      )
    ).toHaveLength(0)
  },
}

const employeeUpdateFixture =
  createPlatformEmployeesRolesScenario("withoutCatalogRead")
export const EmployeeUpdateWithoutCatalogPermissions: Story = {
  args: { page: "employee-detail", employeeAccess: "update" },
  beforeEach: employeeUpdateFixture.reset,
  parameters: {
    msw: {
      handlers: [
        ...employeeUpdateFixture.handlers,
        ...createWorkspaceSessionHandlers(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findByRole("heading", { name: "Mina Chen" })
    await userEvent.clear(canvas.getByLabelText("Name"))
    await userEvent.type(canvas.getByLabelText("Name"), "Mina Chen Updated")
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose Department" })
    )
    const departments = await screen.findByRole("dialog", {
      name: "Department",
    })
    const departmentOption = await within(departments).findByRole("checkbox", {
      name: /Operations/,
    })
    await userEvent.click(departmentOption)
    await userEvent.click(departmentOption)
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await userEvent.click(canvas.getByRole("button", { name: "Choose Posts" }))
    const posts = await screen.findByRole("dialog", { name: "Posts" })
    const postOption = await within(posts).findByText("Support specialist")
    await waitFor(() => expect(postOption).toBeVisible())
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await userEvent.click(canvas.getByRole("button", { name: "Save" }))
    await canvas.findByRole("heading", { name: "Mina Chen Updated" })
    await waitFor(() =>
      expect(
        employeeUpdateFixture.requests.some(
          (request) =>
            request.method === "PATCH" && request.path.includes("/employees/")
        )
      ).toBe(true)
    )
    await expect(
      employeeUpdateFixture.requests.filter((request) =>
        /\/platform\/(departments|posts|roles)(?:\/|$)/.test(request.path)
      )
    ).toHaveLength(0)
    await expect(canvas.queryByRole("alert")).toBeNull()
  },
}

const employeeOptionsCacheFixture =
  createPlatformEmployeesRolesScenario("withoutCatalogRead")
export const EmployeeOptionsCacheSeparatesFilterAndForm: Story = {
  args: { page: "employees", employeeAccess: "update" },
  beforeEach: employeeOptionsCacheFixture.reset,
  parameters: {
    msw: {
      handlers: [
        ...employeeOptionsCacheFixture.handlers,
        ...createWorkspaceSessionHandlers(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await canvas.findByRole("link", { name: "Mina Chen" })
    await userEvent.click(canvas.getByRole("button", { name: "Department" }))
    const filter = await screen.findByRole("dialog", { name: "Department" })
    await within(filter).findByText("Retired department")
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await userEvent.click(canvas.getByRole("link", { name: "Mina Chen" }))
    await canvas.findByRole("heading", { name: "Mina Chen" })
    await userEvent.click(
      canvas.getByRole("button", { name: "Choose Department" })
    )
    const formOptions = await screen.findByRole("dialog", {
      name: "Department",
    })
    await within(formOptions).findByRole("checkbox", { name: /Operations/ })
    await expect(
      within(formOptions).queryByText("Retired department")
    ).toBeNull()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { hidden: true })
      ).not.toBeInTheDocument()
    )
    await expect(
      employeeOptionsCacheFixture.requests.filter((request) =>
        /\/platform\/(departments|posts|roles)(?:\/|$)/.test(request.path)
      )
    ).toHaveLength(0)
  },
}
