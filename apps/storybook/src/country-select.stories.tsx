import * as React from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fn, userEvent, waitFor, within } from "storybook/test"
import {
  CountrySelect,
  type CountrySelectProps,
} from "@workspace/ui/components/country-select"
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
    onValueChange: fn(),
    onBlur: fn(),
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
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole("combobox")
    await expect(trigger).toHaveTextContent(/United States|美国/)

    // 清空按钮必须在触发器之外，且键盘可达。
    const clearBtn = canvas.getByRole("button", { name: "Clear selection" })
    await expect(trigger).not.toContainElement(clearBtn)
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await userEvent.tab()
    await expect(clearBtn).toHaveFocus()
    await userEvent.keyboard("{Enter}")
    await expect(args.onValueChange).toHaveBeenLastCalledWith(undefined)

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
    const kpOption = (await screen.findByText("KP")).closest("[role='option']")
    await expect(kpOption).toHaveAttribute("aria-disabled", "true")

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
  const [submittedCountry, setSubmittedCountry] = React.useState("")
  const form = useForm({
    defaultValues: { country: "" },
    validators: { onSubmit: formSchema },
    onSubmit: ({ value }) => setSubmittedCountry(value.country),
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
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid
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
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
            </Field>
          )
        }}
      />
      <Button type="submit">提交表单</Button>
      <output aria-label="已提交国家">{submittedCountry}</output>
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
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(trigger)
    const input = await screen.findByPlaceholderText("搜索国家或地区...")
    await userEvent.type(input, "Singapore")
    await userEvent.keyboard("{Enter}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(submitBtn)
    await expect(canvas.getByLabelText("已提交国家")).toHaveTextContent("SG")
    await expect(new FormData(submitBtn.closest("form")!).get("country")).toBe(
      "SG"
    )

    await userEvent.click(
      canvas.getByRole("button", { name: "Clear selection" })
    )
    await expect(trigger).toHaveTextContent("请选择国家或地区")
    await expect(new FormData(submitBtn.closest("form")!).get("country")).toBe(
      ""
    )
    await userEvent.click(submitBtn)
    await expect(
      await canvas.findByText("必须选择所在国家或地区")
    ).toBeVisible()
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

    // Base UI 首次打开不自动高亮；每次 ArrowDown 移动到下一项。
    await waitFor(() => expect(input).toHaveFocus())
    const firstOption = screen.getByRole("option", { name: /CN/ })
    const secondOption = screen.getByRole("option", { name: /US/ })
    await expect(firstOption).not.toHaveAttribute("data-highlighted")
    await userEvent.keyboard("{ArrowDown}")
    await expect(firstOption).toHaveAttribute("data-highlighted")
    await userEvent.keyboard("{ArrowDown}")
    await expect(secondOption).toHaveAttribute("data-highlighted")
    await userEvent.keyboard("{Enter}")

    // 等待浮层完全关闭
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    // 验证已选中美国
    await expect(trigger).toHaveTextContent(/United States|美国/)
  },
}

export const CountryFiltering: Story = {
  args: {
    locale: "zh-CN",
    include: ["us", "CA", "CN", "SG"],
    exclude: ["ca"],
    preferredCountries: ["SG", "US"],
    showFlag: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("combobox"))
    const input = await screen.findByPlaceholderText("Search countries...")
    const options = screen.getAllByRole("option")
    await expect(options).toHaveLength(3)
    await expect(options[0]).toHaveTextContent("SG")
    await expect(options[1]).toHaveTextContent("US")
    await expect(options[2]).toHaveTextContent("CN")

    // 电话区号、英文别名与本地化名称保留相同的匹配语义。
    for (const query of ["+1", "USA", "美国"]) {
      await userEvent.clear(input)
      await userEvent.type(input, query)
      await expect(screen.getAllByRole("option")).toHaveLength(1)
      await expect(screen.getByRole("option")).toHaveTextContent("US")
    }
    await userEvent.clear(input)
    await userEvent.type(input, "no-such-country")
    await expect(screen.getByText("No country found.")).toBeVisible()
    await expect(screen.queryByRole("option")).not.toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const CustomCountriesAndFilter: Story = {
  args: {
    locale: "zh-CN",
    countries: [
      { code: "CN", name: "China", aliases: ["primary"], callingCode: "+86" },
      {
        code: "US",
        name: "United States",
        aliases: ["secondary"],
        callingCode: "+1",
      },
    ],
    filterCountry: (country, search, localizedName) =>
      country.aliases?.includes(search) === true || localizedName === search,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(canvas.getByRole("combobox"))
    const input = await screen.findByPlaceholderText("Search countries...")
    await expect(screen.getAllByRole("option")).toHaveLength(2)
    await userEvent.type(input, "secondary")
    await expect(screen.getByRole("option")).toHaveTextContent("US")
    await userEvent.clear(input)
    await userEvent.type(input, "中国")
    await expect(screen.getByRole("option")).toHaveTextContent("CN")
    await userEvent.clear(input)
    await userEvent.type(input, "+86")
    await expect(screen.getByText("No country found.")).toBeVisible()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

export const KeyboardRejectsDisabledCountry: Story = {
  args: {
    include: ["CN", "US", "CA"],
    preferredCountries: ["CN", "US", "CA"],
    isCountryDisabled: (country) => country.code === "US",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("combobox")
    await userEvent.click(trigger)
    const input = await screen.findByPlaceholderText("Search countries...")
    await waitFor(() => expect(input).toHaveFocus())
    await expect(args.onBlur).not.toHaveBeenCalled()
    // Base UI 允许高亮禁用项供读屏说明，但任何入口都不能提交禁用国家。
    await userEvent.keyboard("{ArrowDown}{ArrowDown}")
    const disabledOption = screen.getByRole("option", { name: /US/ })
    await expect(disabledOption).toHaveAttribute("data-highlighted")
    await expect(disabledOption).toHaveAttribute("aria-disabled", "true")
    await userEvent.keyboard("{Enter}")
    await expect(trigger).toHaveTextContent("Select country or region")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(args.onValueChange).not.toHaveBeenCalled()
    await userEvent.keyboard("{ArrowDown}{Enter}")
    await expect(trigger).toHaveTextContent(/Canada|加拿大/)
    await expect(args.onValueChange).toHaveBeenLastCalledWith("CA")
    await expect(args.onBlur).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  },
}

function NativeFormExample() {
  return (
    <form aria-label="国家表单" className="w-80 space-y-4">
      <CountrySelect
        name="country"
        defaultValue="us"
        clearable
        locale="en-US"
      />
      <CountrySelect
        name="disabledCountry"
        defaultValue="CN"
        disabled
        locale="en-US"
      />
    </form>
  )
}

export const NativeFormData: Story = {
  render: () => <NativeFormExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const form = canvas.getByRole<HTMLFormElement>("form", { name: "国家表单" })
    await expect(new FormData(form).get("country")).toBe("US")
    await expect(new FormData(form).has("disabledCountry")).toBe(false)
    const trigger = canvas.getByRole("combobox", { name: "United States" })
    await userEvent.click(trigger)
    const input = await screen.findByPlaceholderText("Search countries...")
    await userEvent.type(input, "Singapore")
    await userEvent.keyboard("{Enter}")
    await expect(new FormData(form).get("country")).toBe("SG")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "Clear selection" })
    )
    await expect(new FormData(form).get("country")).toBe("")
  },
}

function ControlledEmptyExample(props: CountrySelectProps) {
  const [value, setValue] = React.useState<string | undefined>()
  return (
    <CountrySelect
      {...props}
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue)
        props.onValueChange?.(nextValue)
      }}
    />
  )
}

export const ControlledUndefinedValue: Story = {
  args: {
    clearable: true,
    preferredHeading: "Countries",
    allHeading: "Countries",
  },
  render: (args) => <ControlledEmptyExample {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("combobox")
    for (const country of ["Singapore", "Canada"]) {
      await userEvent.click(trigger)
      const input = await screen.findByPlaceholderText("Search countries...")
      await userEvent.type(input, country)
      await userEvent.keyboard("{Enter}")
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      await expect(trigger).not.toHaveTextContent("Select country or region")
      await userEvent.click(
        canvas.getByRole("button", { name: "Clear selection" })
      )
      await expect(trigger).toHaveTextContent("Select country or region")
      await expect(args.onValueChange).toHaveBeenLastCalledWith(undefined)
    }
  },
}

export const ClosedKeyboardRejectsDisabledCountry: Story = {
  args: {
    locale: "en-US",
    preferredCountries: ["KP", "CN", "US"],
    isCountryDisabled: (country) => country.code === "KP",
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const screen = within(canvasElement.ownerDocument.body)
    const trigger = canvas.getByRole("combobox")
    await userEvent.click(trigger)
    await screen.findByPlaceholderText("Search countries...")
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() => expect(trigger).toHaveFocus())
    await userEvent.keyboard("North Korea")
    await expect(trigger).toHaveTextContent("Select country or region")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(args.onValueChange).not.toHaveBeenCalled()
  },
}
