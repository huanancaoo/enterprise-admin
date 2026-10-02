import {
  createLocaleSettingsScenario,
  type LocaleSettingsScenario,
  type LocaleSettingsTarget,
} from "@workspace/mocks"
import { expect, userEvent, within } from "storybook/test"

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
  await userEvent.click(
    await within(canvasElement.ownerDocument.body).findByRole("option", {
      name,
    })
  )
  return {
    canvas,
    control,
    submit: canvas.getByRole("button", { name: "Save" }),
  }
}
export async function arabicSaved(canvasElement: HTMLElement) {
  const canvas = within(canvasElement)
  await canvas.findByRole("heading", { name: "إعدادات اللغة الشخصية" })
  await expect(await canvas.findByRole("status")).toHaveTextContent(
    "تم حفظ إعدادات اللغة."
  )
  await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
    "dir",
    "rtl"
  )
}
