import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import { delay, http, HttpResponse } from "msw"
import {
  AuthGate,
  createWorkspaceAuthClient,
  DeviceAccountSwitcher,
  useAuthAction,
} from "@workspace/admin/auth"

const accounts = ["Alice", "Bob"].map((name) => ({
  user: {
    id: name,
    name,
    email: `${name.toLowerCase()}@example.test`,
    emailVerified: true,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  },
  session: {
    id: `session-${name}`,
    userId: name,
    token: `token-${name}`,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  },
}))

function SessionStory(
  props: Omit<Parameters<typeof DeviceAccountSwitcher>[0], "action">
) {
  const [client] = useState(createWorkspaceAuthClient)
  const action = useAuthAction()
  return (
    <AuthGate client={client} restoreTitle="Accounts">
      {() => (
        <main className="p-6">
          <DeviceAccountSwitcher {...props} action={action} />
        </main>
      )}
    </AuthGate>
  )
}

const meta = {
  title: "Admin/Device accounts",
  component: SessionStory,
  args: { onAddAccount: fn(), onSessionChanged: fn() },
  parameters: {
    a11y: { test: "error" },
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () =>
          HttpResponse.json(accounts[0])
        ),
        http.get("*/api/auth/multi-session/list-device-sessions", () =>
          HttpResponse.json(accounts)
        ),
        http.post("*/api/auth/multi-session/set-active", () =>
          HttpResponse.json(accounts[1])
        ),
      ],
    },
  },
} satisfies Meta<typeof SessionStory>
export default meta
type Story = StoryObj<typeof meta>

const emptyListResolved = fn()
export const NoDeviceSessions: Story = {
  beforeEach: () => {
    emptyListResolved.mockClear()
  },
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () => HttpResponse.json(null)),
        http.get("*/api/auth/multi-session/list-device-sessions", async () => {
          await delay(200)
          emptyListResolved()
          return HttpResponse.json([])
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("main")
    await expect(
      canvas.queryByRole("button", { name: "切换账号" })
    ).not.toBeInTheDocument()
    await waitFor(() => expect(emptyListResolved).toHaveBeenCalled())
    await expect(
      canvas.queryByRole("button", { name: "切换账号" })
    ).not.toBeInTheDocument()
  },
}

export const SavedAccountWithoutCurrentSession: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () => HttpResponse.json(null)),
        http.get("*/api/auth/multi-session/list-device-sessions", () =>
          HttpResponse.json([accounts[0]])
        ),
        http.post("*/api/auth/multi-session/set-active", () =>
          HttpResponse.json(accounts[0])
        ),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "切换账号" })
    )
    const alice = await screen.findByRole("menuitemradio", {
      name: /alice@example.test/,
    })
    await expect(alice).toHaveAttribute("aria-checked", "false")
    await userEvent.click(alice)
    await waitFor(() => expect(args.onSessionChanged).toHaveBeenCalledTimes(1))
  },
}

let refreshListAttempts = 0
export const RefreshSavedAccountsOnOpen: Story = {
  beforeEach: () => {
    refreshListAttempts = 0
  },
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () => HttpResponse.json(null)),
        http.get("*/api/auth/multi-session/list-device-sessions", () => {
          refreshListAttempts += 1
          return HttpResponse.json(
            refreshListAttempts === 1 ? [accounts[0]] : accounts
          )
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "切换账号" })
    )
    // 刷新响应可能早于菜单定位完成；DOM 已挂载不代表菜单项已可见。
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /bob@example.test/ })
      ).toBeVisible()
    )
    await expect(refreshListAttempts).toBe(2)
  },
}

export const KeyboardSwitch: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await canvas.findByRole("button", { name: "切换账号" })
    )
    const alice = await screen.findByRole("menuitemradio", {
      name: /alice@example.test/,
    })
    await expect(alice).toHaveAttribute("aria-checked", "true")
    const bob = await screen.findByRole("menuitemradio", {
      name: /bob@example.test/,
    })
    bob.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(args.onSessionChanged).toHaveBeenCalledTimes(1))
  },
}

export const FailedSwitchKeepsCurrentAccount: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () =>
          HttpResponse.json(accounts[0])
        ),
        http.get("*/api/auth/multi-session/list-device-sessions", () =>
          HttpResponse.json(accounts)
        ),
        http.post("*/api/auth/multi-session/set-active", () =>
          HttpResponse.json(
            { code: "INTERNAL_SERVER_ERROR", message: "切换失败，请重试。" },
            { status: 503 }
          )
        ),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "切换账号" })
    )
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /bob@example.test/ })
    )
    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "切换失败，请重试。"
    )
    await expect(
      screen.getByRole("menuitemradio", { name: /alice@example.test/ })
    ).toHaveAttribute("aria-checked", "true")
    await expect(args.onSessionChanged).not.toHaveBeenCalled()
  },
}

let listAttempts = 0
export const LoadingFailureCanRetry: Story = {
  beforeEach: () => {
    listAttempts = 0
  },
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () => HttpResponse.json(null)),
        http.get("*/api/auth/multi-session/list-device-sessions", () => {
          listAttempts += 1
          return listAttempts === 1
            ? HttpResponse.json({ message: "Unavailable" }, { status: 503 })
            : HttpResponse.json(accounts)
        }),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "切换账号" })
    )
    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法加载账号列表，请重试。"
    )
    await expect(screen.getByRole("menuitem", { name: "重试" })).toBeEnabled()
    await userEvent.click(screen.getByRole("menuitem", { name: "重试" }))
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /bob@example.test/ })
      ).toBeVisible()
    )
  },
}

export const PendingSwitchKeepsActionLocked: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get("*/api/auth/get-session", () =>
          HttpResponse.json(accounts[0])
        ),
        http.get("*/api/auth/multi-session/list-device-sessions", () =>
          HttpResponse.json(accounts)
        ),
        http.post("*/api/auth/multi-session/set-active", async () => {
          await delay(500)
          return HttpResponse.json(accounts[1])
        }),
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = await canvas.findByRole("button", { name: "切换账号" })
    await userEvent.click(trigger)
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: /bob@example.test/ })
    )
    await expect(trigger).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await expect(trigger).toBeDisabled()
    await waitFor(() => expect(args.onSessionChanged).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.queryByRole("menu", { hidden: true })).toBeNull()
    )
  },
}

export const ArabicRtl: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await within(canvasElement).findByRole("button", { name: "تبديل الحساب" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: /bob@example.test/ })
      ).toBeVisible()
    )
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
    await expect(
      screen.getByRole("menuitem", { name: "تسجيل الخروج من جميع الحسابات" })
    ).toBeVisible()
  },
}
