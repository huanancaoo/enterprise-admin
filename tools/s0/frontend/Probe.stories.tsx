import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, within, userEvent } from "storybook/test"
import { http, HttpResponse } from "msw"
import { Probe } from "./Probe"

const meta = {
  title: "S0/Compatibility",
  component: Probe,
  parameters: {
    msw: [http.get("/s0/probe", () => HttpResponse.json({ ok: true }))],
    a11y: { test: "error" },
  },
} satisfies Meta<typeof Probe>
export default meta
type Story = StoryObj<typeof meta>

export const English: Story = {
  globals: { locale: "en-US" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "Load" }))
    await expect(await canvas.findByRole("status")).toHaveTextContent("Loaded")
    await expect(document.documentElement.lang).toBe("en-US")
    await expect(document.documentElement.dir).toBe("ltr")
  },
}

export const Arabic: Story = {
  globals: { locale: "ar" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole("button", { name: "تحميل" }))
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "تم التحميل"
    )
    await expect(document.documentElement.lang).toBe("ar")
    await expect(document.documentElement.dir).toBe("rtl")
  },
}
