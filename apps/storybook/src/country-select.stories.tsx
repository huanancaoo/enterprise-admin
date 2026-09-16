import * as React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { CountrySelect } from "@workspace/ui/components/country-select"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldLabel,
  FieldError,
  FieldDescription,
} from "@workspace/ui/components/field"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"

const meta = {
  title: "UI/CountrySelect",
  component: CountrySelect,
  parameters: {
    a11y: { test: "error" },
  },
  args: {
    placeholder: "Select country or region",
    searchPlaceholder: "Search countries...",
    emptyText: "No country found.",
    preferredHeading: "Frequently used",
    allHeading: "All countries",
  },
} satisfies Meta<typeof CountrySelect>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    const trigger = canvas.getByRole("combobox")
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveTextContent("Select country or region")

    // 点击打开下拉搜索浮层
    await userEvent.click(trigger)
    const searchInput = await screen.findByPlaceholderText(
      "Search countries..."
    )
    await waitFor(() => expect(searchInput).toBeVisible())

    // 输入搜索关键词并选择
    await userEvent.type(searchInput, "Singapore")
    const option = await screen.findByText(/Singapore|新加坡/)
    await userEvent.click(option)

    // 等待浮层退出动画完成
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    // 验证选中后关闭浮层且触发器显示所选内容
    await expect(trigger).toHaveTextContent(/Singapore|新加坡/)
  },
}

export const WithFlag: Story = {
  args: {
    showFlag: true,
    defaultValue: "CA",
  },
}

export const WithoutFlag: Story = {
  args: {
    showFlag: false,
    defaultValue: "CA",
  },
}

export const PreferredCountries: Story = {
  args: {
    preferredCountries: ["CN", "US", "SG", "CA"],
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole("combobox"))
    const input = await screen.findByPlaceholderText("Search countries...")
    await waitFor(() => expect(input).toBeVisible())

    // 验证常用置顶分组与全部国家分组
    await expect(screen.getByText("Frequently used")).toBeVisible()
    await expect(screen.getByText("All countries")).toBeVisible()
    await userEvent.keyboard("{Escape}")

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const Search: Story = {
  args: {
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole("combobox"))
    const input = await screen.findByPlaceholderText("Search countries...")
    await waitFor(() => expect(input).toBeVisible())

    // 按国际区号 "+1" 搜索，应命中 US 与 CA
    await userEvent.type(input, "+1")
    await expect(screen.getByText("US")).toBeVisible()
    await expect(screen.getByText("CA")).toBeVisible()

    // 键入 Escape 关闭并等待浮层消失
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const Clearable: Story = {
  args: {
    clearable: true,
    defaultValue: "US",
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("combobox")
    await expect(trigger).toHaveTextContent(/United States|美国/)

    // 点击清空按钮
    const clearBtn = canvas.getByRole("button", { name: "Clear selection" })
    await userEvent.click(clearBtn)

    // 验证回到占位文本
    await expect(trigger).toHaveTextContent("Select country or region")
  },
}

export const Disabled: Story = {
  args: {
    disabled: true,
    defaultValue: "US",
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("combobox")
    await expect(trigger).toBeDisabled()
  },
}

export const DisabledCountry: Story = {
  args: {
    isCountryDisabled: (c) => c.code === "KP",
    showFlag: true,
    preferredCountries: ["KP", "CN", "US"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)

    await userEvent.click(canvas.getByRole("combobox"))
    const kpOption = screen
      .getByText("KP")
      .closest("[data-slot='command-item']")
    await expect(kpOption).toHaveAttribute("data-disabled", "true")

    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const Invalid: Story = {
  args: {
    invalid: true,
    placeholder: "请选择国家",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("combobox")
    await expect(trigger).toHaveAttribute("aria-invalid", "true")
  },
}

export const LocalizedZhCN: Story = {
  args: {
    locale: "zh-CN",
    defaultValue: "US",
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("combobox")).toHaveTextContent("美国")
  },
}

export const LocalizedEnUS: Story = {
  args: {
    locale: "en-US",
    defaultValue: "US",
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("combobox")).toHaveTextContent(
      "United States"
    )
  },
}

export const LocalizedArRTL: Story = {
  globals: { locale: "ar" },
  args: {
    locale: "ar",
    defaultValue: "US",
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole("combobox")).toHaveTextContent(
      "الولايات المتحدة"
    )
  },
}

const formSchema = z.object({
  country: z.string().min(1, "必须选择所在国家或地区"),
})

function InsideFormExample() {
  const form = useForm({
    defaultValues: { country: "" } as z.infer<typeof formSchema>,
    validators: { onSubmit: formSchema },
    onSubmit: () => {},
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="w-80 space-y-4"
    >
      <form.Field
        name="country"
        children={(field) => {
          const isInvalid = field.state.meta.errors.length > 0
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>注册国家/地区</FieldLabel>
              <CountrySelect
                id={field.name}
                name={field.name}
                value={field.state.value}
                onValueChange={(val) => field.handleChange(val ?? "")}
                onBlur={field.handleBlur}
                invalid={isInvalid}
                showFlag
                clearable
                preferredCountries={["CN", "US", "SG", "CA"]}
                placeholder="请选择国家或地区"
                searchPlaceholder="搜索国家或地区..."
              />
              <FieldDescription>
                我们将根据此国家提供相应合规服务
              </FieldDescription>
              {isInvalid && (
                <FieldError
                  errors={field.state.meta.errors.map((m) => ({
                    message: typeof m === "string" ? m : m?.message,
                  }))}
                />
              )}
            </Field>
          )
        }}
      />
      <Button type="submit">提交表单</Button>
    </form>
  )
}

export const InsideTanStackForm: Story = {
  render: () => <InsideFormExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const submitBtn = canvas.getByRole("button", { name: "提交表单" })

    // 未选择时点击提交，触发校验
    await userEvent.click(submitBtn)
    await expect(
      await canvas.findByText("必须选择所在国家或地区")
    ).toBeVisible()

    const trigger = canvas.getByRole("combobox")
    await expect(trigger).toHaveAttribute("aria-invalid", "true")
  },
}

export const KeyboardNavigation: Story = {
  args: {
    showFlag: true,
    preferredCountries: ["CN", "US", "SG", "CA"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("combobox")

    // Tab 聚焦并按 Enter 展开
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard("{Enter}")

    const input = await screen.findByPlaceholderText("Search countries...")
    await waitFor(() => expect(input).toBeVisible())

    // 默认高亮首项（中国），向下移动一行高亮第二项（美国），回车确认选择
    await userEvent.keyboard("{ArrowDown}{Enter}")

    // 等待浮层完全关闭
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    // 验证已选中美国
    await expect(trigger).toHaveTextContent(/United States|美国/)
  },
}
