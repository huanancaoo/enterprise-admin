import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { projectScenarios } from "@workspace/mocks"
import { ProjectsExample } from "./projects-example"

const meta = {
  title: "Admin/Projects list",
  component: ProjectsExample,
  parameters: {
    layout: "fullscreen",
    msw: { handlers: projectScenarios.success },
  },
} satisfies Meta<typeof ProjectsExample>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("办公空间 1-26")).toBeVisible()
    await userEvent.type(canvas.getByLabelText("项目名称"), "1-25")
    await waitFor(() => {
      expect(canvas.queryByText("办公空间 1-26")).not.toBeInTheDocument()
      expect(canvas.getByText("共 1 条")).toBeVisible()
    })
  },
}
export const Loading: Story = {
  parameters: { msw: { handlers: projectScenarios.loading } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("table")).toHaveAttribute(
      "aria-busy",
      "true"
    )
  },
}
export const Empty: Story = {
  parameters: { msw: { handlers: projectScenarios.empty } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("还没有项目")
    ).toBeVisible()
  },
}
export const Error: Story = {
  parameters: { msw: { handlers: projectScenarios.serverError } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("alert")
    ).toHaveTextContent("加载失败")
  },
}
export const PermissionDenied: Story = {
  args: { canCreate: false },
  parameters: { msw: { handlers: projectScenarios.forbidden } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("alert")).toHaveTextContent("无权访问")
    await expect(
      canvas.queryByRole("button", { name: "创建项目" })
    ).not.toBeInTheDocument()
  },
}
export const LongText: Story = {
  parameters: { msw: { handlers: projectScenarios.longText } },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector("table")).toBeInTheDocument()
    )
    await expect(
      canvasElement.ownerDocument.documentElement.scrollWidth
    ).toBeLessThanOrEqual(window.innerWidth)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await expect(await canvas.findByText("مساحة المكتب 1-26")).toBeVisible()
    await expect(document.documentElement).toHaveAttribute("lang", "ar")
    await expect(document.documentElement).toHaveAttribute("dir", "rtl")
    const resize = canvas.getByRole("separator", {
      name: "تغيير عرض اسم المشروع",
    })
    const width = Number(resize.getAttribute("aria-valuenow"))
    resize.focus()
    await userEvent.keyboard("{ArrowLeft}")
    await expect(resize).toHaveAttribute("aria-valuenow", String(width + 10))
    const sidebar = canvas.getByRole("complementary").getBoundingClientRect()
    const main = canvas.getByRole("main").getBoundingClientRect()
    await expect(sidebar.left).toBeGreaterThan(main.left)
    await userEvent.click(canvas.getByRole("button", { name: "العرض" }))
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: "إعدادات الأعمدة" })
      ).toBeVisible()
    )
    await userEvent.keyboard("{Escape}")
    await userEvent.click(
      canvas.getByRole("button", { name: "الصفحة التالية" })
    )
    await expect(await canvas.findByText("مساحة المكتب 1-16")).toBeVisible()
  },
}
export const SlowNetwork: Story = {
  parameters: { msw: { handlers: projectScenarios.slow } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("table")).toHaveAttribute("aria-busy", "true")
    await expect(
      await canvas.findByText("办公空间 1-26", {}, { timeout: 3000 })
    ).toBeVisible()
  },
}
export const SwitchLocaleAndTenant: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await expect(await canvas.findByText("办公空间 1-26")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "语言" }))
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "English" })
    )
    await expect(await canvas.findByText("Office space 1-26")).toBeVisible()
    await expect(document.documentElement).toHaveAttribute("lang", "en-US")
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Select organization" })
    )
    await userEvent.click(
      await screen.findByRole("option", { name: "South workspace" })
    )
    await expect(await canvas.findByText("Office space 2-26")).toBeVisible()
    await expect(
      canvas.queryByText("Office space 1-26")
    ).not.toBeInTheDocument()
  },
}
