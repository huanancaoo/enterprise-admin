import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { chooseLocale, localeScenario } from "./locale-settings.story-utils"
import { LocaleSettingsStory } from "./locale-settings.story-fixture"

const scenario = (name: Parameters<typeof localeScenario>[1] = "success") =>
  localeScenario("organization", name)
const meta = {
  title: "Admin/Organization language settings",
  component: LocaleSettingsStory,
  args: { target: "organization" },
  globals: { locale: "en-US" },
  ...scenario(),
} satisfies Meta<typeof LocaleSettingsStory>
export default meta
type Story = StoryObj<typeof meta>
const loaded: Story["play"] = async ({ canvasElement }) => {
  const control = await within(canvasElement).findByRole("combobox", {
    name: "Language",
  })
  await waitFor(() => expect(control).toHaveTextContent("English"))
}
const readError: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await expect(await canvas.findByRole("alert")).toHaveTextContent(
    "Language settings could not be loaded."
  )
  await expect(canvas.queryByRole("combobox")).toBeNull()
}
export const Default: Story = { play: loaded }
export const Loading: Story = {
  ...scenario("loading"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("status")
    ).toHaveTextContent("Loading…")
  },
}
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("combobox")
    ).toHaveTextContent("Follow platform default")
  },
}
export const Error: Story = { ...scenario("unavailable"), play: readError }
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "You do not have permission to view or change organization language settings."
    )
    await expect(canvas.queryByRole("combobox")).toBeNull()
  },
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: readError,
}
export const ReadOnly: Story = {
  ...scenario("readOnly"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText(
      "You can view this organization's settings, but you cannot change them."
    )
    await expect(canvas.getByRole("combobox")).toBeDisabled()
    await expect(canvas.queryByRole("button", { name: "Save" })).toBeNull()
  },
}
export const PermissionLookupUnavailable: Story = {
  ...scenario("permissionUnavailable"),
  play: readError,
}
// 设置值仅有三个 locale 或 null；长文本用现有继承文案和窄区域验证。
export const LongText: Story = {
  ...scenario("empty"),
  args: { narrow: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("combobox")).toHaveTextContent(
      "Follow platform default"
    )
    const main = canvas.getByRole("main")
    await expect(main.scrollWidth).toBe(main.clientWidth)
  },
}
export const RTL: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("combobox", { name: "اللغة" })
    await expect(
      canvas.getByRole("heading", { name: "إعدادات لغة المؤسسة" })
    ).toBeVisible()
    await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
      "dir",
      "rtl"
    )
  },
}
export const Chinese: Story = {
  globals: { locale: "zh-CN" },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("combobox", { name: "语言" })
  },
}
export const SlowNetwork: Story = {
  ...scenario("slow"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole("status")
    await canvas.findByRole("combobox")
  },
}
export const SaveWithKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "العربية"
    )
    submit.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(submit).toBeDisabled())
    await waitFor(() => expect(control).toBeDisabled())
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Language settings saved."
    )
    await expect(control).toHaveTextContent("العربية")
  },
}
export const SaveLoading: Story = {
  ...scenario("saveLoading"),
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "العربية"
    )
    await userEvent.click(submit)
    await waitFor(() => expect(control).toBeDisabled())
    await expect(canvas.getByRole("button", { name: "Saving…" })).toBeDisabled()
  },
}
const retry: Story["play"] = async ({ canvasElement }) => {
  const { canvas, control, submit } = await chooseLocale(
    canvasElement,
    "العربية"
  )
  await userEvent.click(submit)
  await expect(await canvas.findByRole("alert")).toHaveTextContent(
    "Language settings could not be saved."
  )
  await expect(control).toHaveTextContent("العربية")
  await userEvent.click(submit)
  await expect(await canvas.findByRole("status")).toHaveTextContent(
    "Language settings saved."
  )
}
export const SaveUnavailable: Story = {
  ...scenario("saveUnavailable"),
  play: retry,
}
export const RateLimited: Story = { ...scenario("rateLimited"), play: retry }
export const StaleVersion: Story = {
  ...scenario("stale"),
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "العربية"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Another administrator changed these settings."
    )
    await expect(control).toHaveTextContent("العربية")
    await userEvent.click(submit)
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Language settings saved."
    )
    await expect(control).toHaveTextContent("العربية")
  },
}
export const SavePermissionDenied: Story = {
  ...scenario("saveForbidden"),
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "العربية"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "You do not have permission to view or change organization language settings."
    )
    await expect(control).toHaveTextContent("العربية")
  },
}
export const SaveSessionExpired: Story = {
  ...scenario("saveUnauthorized"),
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "العربية"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Language settings could not be saved."
    )
    await expect(control).toHaveTextContent("العربية")
  },
}
export const ClearDefault: Story = {
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "Follow platform default"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "Language settings saved."
    )
    await expect(control).toHaveTextContent("Follow platform default")
  },
}
