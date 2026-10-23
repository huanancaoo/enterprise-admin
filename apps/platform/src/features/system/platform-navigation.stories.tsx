import { createElement, useState } from "react"
import { useTranslation } from "react-i18next"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { NavMain, type NavMainItem } from "@workspace/admin"
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar"
import { platformNavigationModel, platformPages } from "./platform-pages"

function NavigationStory({
  permissions,
  initialPath,
}: {
  permissions: string[]
  initialPath: string
}) {
  const [pathname, setPathname] = useState(initialPath)
  const { t } = useTranslation([
    "common",
    "system",
    "organization",
    "identity",
    "employees",
    "roles",
    "catalogs",
    "files",
    "monitor",
    "platformTasks",
    "announcements",
  ])
  const model = platformNavigationModel(permissions, pathname)
  function entries(nodes: typeof model.items): NavMainItem[] {
    return nodes.map((node) => ({
      title: t(node.titleKey),
      icon: createElement(node.Icon),
      isActive: node.isActive,
      items: entries(node.children),
      render: node.target ? (
        <a
          href={node.target.to}
          onClick={(event) => {
            event.preventDefault()
            setPathname(node.target!.to)
          }}
        />
      ) : undefined,
    }))
  }
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
          <NavMain label={t("navigation")} items={entries(model.items)} />
        </SidebarContent>
      </Sidebar>
      <main className="w-full p-6">
        <SidebarTrigger />
        <h1>{model.section ? t(model.section.titleKey) : t("navigation")}</h1>
        <output aria-label={t("navigation")}>{pathname}</output>
      </main>
    </SidebarProvider>
  )
}
const meta = {
  title: "Platform/System/Navigation access",
  component: NavigationStory,
  globals: { locale: "zh-CN" },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  args: {
    permissions: Object.values(platformPages).map((page) => page.permission),
    initialPath: "/platform/roles/role/permissions",
  },
} satisfies Meta<typeof NavigationStory>
export default meta
type Story = StoryObj<typeof meta>

export const FixedHierarchy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const navigation = within(
      canvas.getByRole("navigation", { name: "主导航" })
    )
    await expect(
      navigation.getByRole("link", { name: "角色管理" })
    ).toHaveAttribute("aria-current", "page")
    await expect(
      navigation.queryByRole("link", { name: "菜单管理" })
    ).toBeNull()
    await userEvent.click(navigation.getByRole("button", { name: "安全审计" }))
    await userEvent.click(navigation.getByRole("link", { name: "登录日志" }))
    await expect(
      navigation.getByRole("link", { name: "登录日志" })
    ).toHaveAttribute("aria-current", "page")
    await expect(
      canvas.getByRole("status", { name: "主导航" })
    ).toHaveTextContent("/platform/login-events")
  },
}
export const RestrictedRole: Story = {
  args: {
    permissions: ["platform.post:read", "platform.settings:read"],
    initialPath: "/platform/posts",
  },
  play: async ({ canvasElement }) => {
    const navigation = within(
      within(canvasElement).getByRole("navigation", { name: "主导航" })
    )
    await expect(
      navigation
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["平台团队", "系统配置"])
    await expect(
      navigation.getByRole("link", { name: "岗位管理" })
    ).toBeVisible()
    await expect(
      navigation.queryByRole("link", { name: "角色管理" })
    ).toBeNull()
  },
}
