import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { LocaleSwitcher } from "@workspace/admin"

const meta = {
  title: "Admin/Locale switcher",
  component: LocaleSwitcher,
  parameters: {
    a11y: { test: "error" },
  },
} satisfies Meta<typeof LocaleSwitcher>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    const trigger = canvas.getByRole("button", { name: "语言" })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveTextContent("简体中文")

    // 点击展开下拉菜单并切换为 English
    await userEvent.click(trigger)
    const enOption = await screen.findByRole("menuitemradio", {
      name: "English",
    })
    await userEvent.click(enOption)

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("lang", "en-US")
    )
    await expect(trigger).toHaveTextContent("English")
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )

    // 再次点击切换为阿拉伯语（RTL）
    await userEvent.click(trigger)
    const arOption = await screen.findByRole("menuitemradio", {
      name: "العربية",
    })
    await userEvent.click(arOption)

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("dir", "rtl")
    )
    await expect(document.documentElement).toHaveAttribute("lang", "ar")
    await expect(trigger).toHaveTextContent("العربية")
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )

    // 恢复为中文
    await userEvent.click(trigger)
    const zhOption = await screen.findByRole("menuitemradio", {
      name: "简体中文",
    })
    await userEvent.click(zhOption)

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("dir", "ltr")
    )
    await expect(document.documentElement).toHaveAttribute("lang", "zh-CN")
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )
  },
}

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6 p-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          1. 默认图文下拉菜单 (variant=&quot;dropdown&quot;)
        </p>
        <LocaleSwitcher variant="dropdown" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          2. 纯图标极简按钮 (variant=&quot;icon&quot;)
        </p>
        <LocaleSwitcher variant="icon" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">
          3. 原生表单选择框 (variant=&quot;select&quot;)
        </p>
        <LocaleSwitcher variant="select" />
      </div>
    </div>
  ),
}

export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("button", { name: "اللغة" })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveTextContent("العربية")
    await expect(document.documentElement).toHaveAttribute("dir", "rtl")
    await expect(document.documentElement).toHaveAttribute("lang", "ar")
  },
}

export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    const trigger = canvas.getByRole("button", { name: "语言" })
    trigger.focus()
    await expect(trigger).toHaveFocus()

    // 按 Enter 键打开菜单
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(screen.getAllByRole("menuitemradio").length).toBeGreaterThan(0)
    )

    // 按 Escape 键关闭菜单
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument()
    )
    await expect(trigger).toHaveFocus()
  },
}
