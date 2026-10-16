import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { http, HttpResponse } from "msw"
import { NavUser } from "@workspace/admin"
import {
  AuthGate,
  createWorkspaceAuthClient,
  DeviceSessionMenu,
  DeviceSessionActions,
} from "@workspace/admin/auth"
import { SidebarProvider } from "@workspace/ui/components/sidebar"

const meta = {
  title: "Admin/Nav user",
  component: NavUser,
  decorators: [
    (Story) => (
      <SidebarProvider
        labels={{
          toggle: "切换侧栏",
          mobileTitle: "侧栏",
          mobileDescription: "显示移动端导航。",
        }}
      >
        <div className="flex min-h-144 w-64 items-end bg-sidebar p-2 text-sidebar-foreground">
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
    accountMenu: () => null,
    signOutMenu: () => null,
    onPersonalSettings: () => undefined,
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
      expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0)
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
      expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0)
    )
  },
}

export const ThemeMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole("button", { name: /测试用户/ }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "主题" }))
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "深色" })
    )

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"))
    await waitFor(() =>
      expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0)
    )

    await userEvent.click(canvas.getByRole("button", { name: /测试用户/ }))
    await userEvent.click(await screen.findByRole("menuitem", { name: "主题" }))
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "浅色" })
    )

    await waitFor(() => expect(document.documentElement).toHaveClass("light"))
    await waitFor(() =>
      expect(screen.queryAllByRole("menuitemradio")).toHaveLength(0)
    )
  },
}

const deviceAccounts = [
  { id: "zhang", name: "张明", email: "zhangming@acme.example" },
  { id: "li", name: "李晓", email: "lixiao@studio.example" },
].map((user) => ({
  user: {
    ...user,
    emailVerified: true,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  },
  session: {
    id: `session-${user.id}`,
    userId: user.id,
    token: `token-${user.id}`,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  },
}))

const sessionChanged = fn()
const currentAccountRevoked = fn()
const allAccountsSignedOut = fn()

function accountHandlers() {
  return [
    http.get("*/api/auth/get-session", () =>
      HttpResponse.json(deviceAccounts[0])
    ),
    http.get("*/api/auth/multi-session/list-device-sessions", () =>
      HttpResponse.json(deviceAccounts)
    ),
    http.post("*/api/auth/multi-session/set-active", () =>
      HttpResponse.json(deviceAccounts[1])
    ),
    http.post("*/api/auth/multi-session/revoke", async ({ request }) => {
      currentAccountRevoked(await request.json())
      return HttpResponse.json({ status: true })
    }),
    http.post("*/api/auth/sign-out", () => {
      allAccountsSignedOut()
      return HttpResponse.json({ success: true })
    }),
  ]
}

function AccountNavUser({
  user,
  onPersonalSettings,
}: Pick<Parameters<typeof NavUser>[0], "user" | "onPersonalSettings">) {
  const [client] = useState(createWorkspaceAuthClient)
  return (
    <AuthGate client={client} restoreTitle="Accounts">
      {() => (
        <NavUser
          user={user}
          onPersonalSettings={onPersonalSettings}
          accountMenu={(action) => (
            <DeviceSessionMenu
              action={action}
              onAddAccount={() => undefined}
              onSessionChanged={sessionChanged}
            />
          )}
          signOutMenu={(action) => (
            <DeviceSessionActions
              action={action}
              onSessionChanged={sessionChanged}
            />
          )}
        />
      )}
    </AuthGate>
  )
}

export const AccountMenu: Story = {
  render: (args) => <AccountNavUser {...args} />,
  args: { user: deviceAccounts[0]!.user },
  beforeEach: () => {
    sessionChanged.mockClear()
    currentAccountRevoked.mockClear()
    allAccountsSignedOut.mockClear()
  },
  parameters: { msw: { handlers: accountHandlers() } },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: /张明/ })
    )
    await expect(
      screen.queryByRole("menuitemradio", { name: /lixiao@studio.example/ })
    ).not.toBeInTheDocument()
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /切换账号.*2 个账号/ })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /lixiao@studio.example/ })
      ).toBeVisible()
    )
    await expect(
      screen.getByRole("menuitemradio", { name: /zhangming@acme.example/ })
    ).toHaveAttribute("aria-checked", "true")
    await expect(
      screen.getByRole("menuitem", { name: "退出当前账号" })
    ).toBeVisible()
    await expect(
      screen.getByRole("menuitem", { name: "退出所有账号" })
    ).toHaveAttribute("data-variant", "destructive")
  },
}

let submenuListAttempts = 0
export const RefreshAccountsOnSubmenuOpen: Story = {
  ...AccountMenu,
  beforeEach: () => {
    submenuListAttempts = 0
  },
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/multi-session/list-device-sessions", () => {
          submenuListAttempts += 1
          return HttpResponse.json(
            submenuListAttempts < 3 ? [deviceAccounts[0]] : deviceAccounts
          )
        }),
        ...accountHandlers(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: /张明/ })
    )
    await waitFor(() => expect(submenuListAttempts).toBe(1))
    await userEvent.click(screen.getByRole("menuitem", { name: /切换账号/ }))
    await waitFor(() => expect(submenuListAttempts).toBe(2))
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /zhangming@acme.example/ })
      ).toBeVisible()
    )

    // 关闭子菜单不会卸载主菜单中的查询，不能依赖重新挂载来发现另一页面新增的账号。
    await userEvent.keyboard("{Escape}{Enter}")
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /lixiao@studio.example/ })
      ).toBeVisible()
    )
    await expect(submenuListAttempts).toBe(3)
  },
}

export const KeyboardAccountSwitch: Story = {
  ...AccountMenu,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: /张明/ })
    )
    const switcher = await screen.findByRole("menuitem", { name: /切换账号/ })
    switcher.focus()
    await userEvent.keyboard("{ArrowRight}")
    const nextAccount = await screen.findByRole("menuitemradio", {
      name: /lixiao@studio.example/,
    })
    await waitFor(() => expect(nextAccount).toBeVisible())
    nextAccount.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(sessionChanged).toHaveBeenCalledTimes(1))
  },
}

export const SignOutCurrentAccount: Story = {
  ...AccountMenu,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: /张明/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "退出当前账号" })
    )
    await waitFor(() => expect(sessionChanged).toHaveBeenCalledTimes(1))
    await expect(currentAccountRevoked).toHaveBeenCalledWith({
      sessionToken: deviceAccounts[0]!.session.token,
    })
    await expect(allAccountsSignedOut).not.toHaveBeenCalled()
  },
}

export const SignOutAllAccounts: Story = {
  ...AccountMenu,
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: /张明/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "退出所有账号" })
    )
    await waitFor(() => expect(sessionChanged).toHaveBeenCalledTimes(1))
    await expect(allAccountsSignedOut).toHaveBeenCalledTimes(1)
    await expect(currentAccountRevoked).not.toHaveBeenCalled()
  },
}

export const ArabicAccountMenu: Story = {
  ...AccountMenu,
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: /张明/ })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /تبديل الحساب/ })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /lixiao@studio.example/ })
      ).toBeVisible()
    )
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}

const longIdentityAccount = {
  ...deviceAccounts[0]!,
  user: {
    ...deviceAccounts[0]!.user,
    name: "负责企业平台与多个业务组织的账号负责人",
    email: "account.owner.with.a.long.name.for.switching@example.test",
  },
}

export const LongIdentity: Story = {
  ...AccountMenu,
  args: { user: longIdentityAccount.user },
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () =>
          HttpResponse.json(longIdentityAccount)
        ),
        http.get("*/api/auth/multi-session/list-device-sessions", () =>
          HttpResponse.json([longIdentityAccount, deviceAccounts[1]])
        ),
        ...accountHandlers(),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", {
        name: /account.owner.with.a.long.name/,
      })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /切换账号/ })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /lixiao@studio.example/ })
      ).toBeVisible()
    )
    for (const menu of screen.getAllByRole("menu")) {
      const box = menu.getBoundingClientRect()
      await expect(box.width).toBeLessThanOrEqual(321)
      await expect(box.left).toBeGreaterThanOrEqual(0)
      await expect(box.right).toBeLessThanOrEqual(window.innerWidth)
    }
  },
}
