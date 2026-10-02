import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import {
  arabicSaved,
  chooseLocale,
  localeScenario,
} from "./locale-settings.story-utils"
import { LocaleSettingsStory } from "./locale-settings.story-fixture"

const scenario = (name: Parameters<typeof localeScenario>[1] = "success") =>
  localeScenario("personal", name)
const meta = {
  title: "Admin/Personal language settings",
  component: LocaleSettingsStory,
  args: { target: "personal" },
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
// nullable 设置的空态就是继承选项，使用真实文案在窄区域验证长标签。
export const Empty: Story = {
  ...scenario("empty"),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("combobox")
    ).toHaveTextContent("Follow organization or platform defaults")
  },
}
export const Error: Story = { ...scenario("unavailable"), play: readError }
export const PermissionDenied: Story = {
  ...scenario("forbidden"),
  play: readError,
}
export const SessionExpired: Story = {
  ...scenario("unauthorized"),
  play: readError,
}
export const LongText: Story = {
  ...scenario("empty"),
  args: { narrow: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("combobox")).toHaveTextContent(
      "Follow organization or platform defaults"
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
      canvas.getByRole("heading", { name: "الإعدادات الشخصية" })
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
    const { control, submit } = await chooseLocale(canvasElement, "العربية")
    submit.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(submit).toBeDisabled())
    await expect(control).toBeDisabled()
    await arabicSaved(canvasElement)
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
  await canvas.findByText("Personal preference")
  await userEvent.click(submit)
  await expect(await canvas.findByRole("alert")).toHaveTextContent(
    "Language settings could not be saved. Your draft is still here."
  )
  await expect(control).toHaveTextContent("العربية")
  await userEvent.click(submit)
  await arabicSaved(canvasElement)
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
    await expect(submit).toBeDisabled()
    await expect(control).toHaveTextContent("العربية")
    await waitFor(() => expect(submit).toBeEnabled())
    await userEvent.click(submit)
    await arabicSaved(canvasElement)
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
const inherit: Story["play"] = async ({ canvasElement }) => {
  const { submit } = await chooseLocale(
    canvasElement,
    "Follow organization or platform defaults"
  )
  await userEvent.click(submit)
  await arabicSaved(canvasElement)
  await expect(
    within(canvasElement).getByRole("combobox", { name: "اللغة" })
  ).toHaveTextContent("اتباع الإعدادات الافتراضية للمؤسسة أو المنصة")
}
export const FollowOrganization: Story = {
  ...scenario("inheritOrganization"),
  play: inherit,
}
export const FollowPlatformInOrganization: Story = {
  ...scenario("inheritPlatform"),
  play: inherit,
}
export const FollowPlatformWithoutOrganization: Story = {
  ...scenario("noOrganization"),
  play: inherit,
}
export const InheritedRefreshUnavailable: Story = {
  ...scenario("refreshUnavailable"),
  play: async ({ canvasElement }) => {
    const { canvas, submit } = await chooseLocale(
      canvasElement,
      "Follow organization or platform defaults"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Settings were saved, but the inherited language could not be refreshed."
    )
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Language settings saved."
    )
    await expect(
      canvas.getByRole("heading", { name: "Personal settings" })
    ).toBeVisible()
  },
}
export const OrganizationLookupUnavailable: Story = {
  ...scenario("organizationUnavailable"),
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "Follow organization or platform defaults"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Language settings could not be saved. Your draft is still here."
    )
    await expect(canvas.queryByRole("status")).toBeNull()
    await expect(control).toHaveTextContent(
      "Follow organization or platform defaults"
    )
  },
}
export const FixedSelectionWithOrganizationLookupError: Story = {
  ...scenario("organizationUnavailable"),
  play: async ({ canvasElement }) => {
    const { submit } = await chooseLocale(canvasElement, "العربية")
    await userEvent.click(submit)
    await arabicSaved(canvasElement)
  },
}
export const FixedSelectionWithOrganizationLoading: Story = {
  ...scenario("organizationLoading"),
  play: async ({ canvasElement }) => {
    const { submit } = await chooseLocale(canvasElement, "العربية")
    await userEvent.click(submit)
    await arabicSaved(canvasElement)
  },
}
export const InheritanceWithOrganizationLoading: Story = {
  ...scenario("organizationLoading"),
  play: async ({ canvasElement }) => {
    const { canvas, control, submit } = await chooseLocale(
      canvasElement,
      "Follow organization or platform defaults"
    )
    await userEvent.click(submit)
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Language settings could not be saved. Your draft is still here."
    )
    await expect(canvas.queryByRole("status")).toBeNull()
    await expect(control).toHaveTextContent(
      "Follow organization or platform defaults"
    )
  },
}
