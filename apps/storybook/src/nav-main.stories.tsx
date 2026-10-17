import { useTranslation } from "react-i18next"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { NavMain, type NavMainProps } from "@workspace/admin"
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"

function NavigationStory(props: NavMainProps) {
  const { t } = useTranslation("common")
  return (
    <SidebarProvider
      labels={{
        toggle: t("toggleSidebar"),
        mobileTitle: t("sidebar"),
        mobileDescription: t("sidebarDescription"),
      }}
    >
      <Sidebar>
        <SidebarContent>
          <NavMain {...props} />
        </SidebarContent>
      </Sidebar>
      <main className="p-6" aria-label="Workspace" />
    </SidebarProvider>
  )
}
const meta = {
  title: "Admin/Navigation",
  globals: { locale: "en-US" },
  component: NavigationStory,
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    label: "Navigation",
    items: [
      {
        title: "System management",
        items: [
          { title: "Employees", render: <a href="#employees" /> },
          {
            title: "Logs",
            items: [
              {
                title: "Operation log",
                isActive: true,
                render: <a href="#operations" />,
              },
              { title: "Login log", render: <a href="#logins" /> },
            ],
          },
        ],
      },
      {
        title: "System monitoring",
        items: [{ title: "Sessions", render: <a href="#sessions" /> }],
      },
    ],
  },
} satisfies Meta<typeof NavigationStory>
export default meta
type Story = StoryObj<typeof meta>

export const ThreeLevels: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole("link", { name: "Operation log" })
    ).toBeVisible()
    await expect(
      canvas.getByRole("link", { name: "Operation log" })
    ).toHaveAttribute("data-active")
    await userEvent.click(canvas.getByRole("button", { name: "Logs" }))
    await expect(
      canvas.queryByRole("link", { name: "Operation log" })
    ).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole("button", { name: "Logs" }))
    await expect(canvas.getByRole("link", { name: "Login log" })).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "System monitoring" })
    )
    await expect(canvas.getByRole("link", { name: "Sessions" })).toBeVisible()
  },
}
export const Arabic: Story = { globals: { locale: "ar" } }

export const ParentPageWithChildren: Story = {
  args: {
    items: [
      {
        title: "Reports",
        render: <a href="#reports" />,
        items: [
          {
            title: "Daily report",
            isActive: true,
            render: <a href="#daily" />,
          },
        ],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("link", { name: "Reports" })).toHaveAttribute(
      "href",
      "#reports"
    )
    await expect(
      canvas.getByRole("link", { name: "Daily report" })
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle Reports submenu" })
    )
    await expect(
      canvas.queryByRole("link", { name: "Daily report" })
    ).not.toBeInTheDocument()
    await expect(canvas.getByRole("link", { name: "Reports" })).toBeVisible()
  },
}
