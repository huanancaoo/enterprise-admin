import { useTranslation } from "react-i18next"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { NavMain, type NavMainProps } from "@workspace/admin"
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"

const navigationIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M9 4v16M9 10h11" />
  </svg>
)

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
      <Sidebar collapsible="icon">
        <SidebarContent>
          <NavMain {...props} />
        </SidebarContent>
      </Sidebar>
      <main className="p-6" aria-label="Workspace">
        <SidebarTrigger />
      </main>
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
        title: "Organizations",
        icon: navigationIcon,
        render: <a href="#organizations" />,
      },
      {
        title: "System management",
        icon: navigationIcon,
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
        icon: navigationIcon,
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
    await waitFor(() =>
      expect(
        canvas.queryByRole("link", { name: "Operation log" })
      ).not.toBeInTheDocument()
    )
    await userEvent.click(canvas.getByRole("button", { name: "Logs" }))
    await waitFor(() =>
      expect(canvas.getByRole("link", { name: "Login log" })).toBeVisible()
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "System monitoring" })
    )
    await waitFor(() =>
      expect(canvas.getByRole("link", { name: "Sessions" })).toBeVisible()
    )
  },
}
export const Arabic: Story = { globals: { locale: "ar" } }

export const ParentPageWithChildren: Story = {
  args: {
    items: [
      {
        title: "Reports",
        icon: navigationIcon,
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
    await waitFor(() =>
      expect(
        canvas.queryByRole("link", { name: "Daily report" })
      ).not.toBeInTheDocument()
    )
    await expect(canvas.getByRole("link", { name: "Reports" })).toBeVisible()
  },
}

export const KeyboardSubmenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole("button", { name: "System monitoring" })
    toggle.focus()
    await userEvent.keyboard("{Enter}")
    await expect(toggle).toHaveAttribute("aria-expanded", "true")
    await waitFor(() =>
      expect(canvas.getByRole("link", { name: "Sessions" })).toBeVisible()
    )
    await userEvent.keyboard(" ")
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await waitFor(() =>
      expect(
        canvas.queryByRole("link", { name: "Sessions" })
      ).not.toBeInTheDocument()
    )
    await expect(toggle).toHaveFocus()
  },
}

export const CollapsedIcons: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const navigation = canvas.getByRole("navigation", { name: "Navigation" })
    const entries = [
      within(navigation).getByRole("link", { name: "Organizations" }),
      within(navigation).getByRole("button", { name: "System management" }),
      within(navigation).getByRole("button", { name: "System monitoring" }),
    ]
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle sidebar" })
    )
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="sidebar"][data-state]')
      ).toHaveAttribute("data-state", "collapsed")
    )
    for (const entry of entries) {
      await expect(entry.querySelector("svg")).toBeVisible()
    }
    // 活跃目录本来已展开；图标模式点击它仍应打开完整侧栏，而不是把子项关掉。
    await userEvent.click(entries[1]!)
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="sidebar"][data-state]')
      ).toHaveAttribute("data-state", "expanded")
    )
    await expect(
      canvas.getByRole("link", { name: "Operation log" })
    ).toBeVisible()
    await userEvent.click(
      canvas.getByRole("button", { name: "Toggle sidebar" })
    )
    await waitFor(() =>
      expect(
        canvasElement.querySelector('[data-slot="sidebar"][data-state]')
      ).toHaveAttribute("data-state", "collapsed")
    )
    await userEvent.click(entries[2]!)
    const sessions = await canvas.findByRole("link", { name: "Sessions" })
    await waitFor(() => expect(sessions).toBeVisible())
    await expect(entries[2]).toHaveAttribute("aria-expanded", "true")
    await expect(sessions).toHaveAttribute("href", "#sessions")
  },
}
