import {
  createLocaleSettingsScenario,
  type LocaleSettingsScenario,
  type LocaleSettingsTarget,
} from "@workspace/mocks"
import { expect, userEvent, waitFor, within } from "storybook/test"

export function localeScenario(
  target: LocaleSettingsTarget,
  name: LocaleSettingsScenario = "success"
) {
  const fixture = createLocaleSettingsScenario(target, name)
  return {
    beforeEach: fixture.reset,
    parameters: { layout: "fullscreen", msw: { handlers: fixture.handlers } },
  }
}
export async function chooseLocale(canvasElement: HTMLElement, name: string) {
  const canvas = within(canvasElement)
  const control = await canvas.findByRole("combobox", { name: "Language" })
  await userEvent.click(control)
  const screen = within(canvasElement.ownerDocument.body)
  const option = await screen.findByRole("option", { name })
  const popup = screen.getByRole("listbox")
  await userEvent.click(option)
  // 选值已更新时弹层仍可能在关闭动画中，后续提交与 axe 应检查最终状态。
  const content = popup.closest<HTMLElement>("[data-slot=select-content]")!
  await waitFor(() => expect(content).toHaveAttribute("data-closed"))
  await Promise.all(
    content.getAnimations().map((animation) => animation.finished)
  )
  await waitFor(() => expect(popup).not.toBeVisible())
  return {
    canvas,
    control,
    submit: canvas.getByRole("button", { name: "Save" }),
  }
}
export async function arabicSaved(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await canvas.findByRole("heading", { name: "الإعدادات الشخصية" })
  await expect(await canvas.findByRole("status")).toHaveTextContent(
    "تم حفظ إعدادات اللغة."
  )
  await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
    "dir",
    "rtl"
  )
}
