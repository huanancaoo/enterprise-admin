import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test"
import { Button } from "@workspace/ui/components/button"
import { useTheme } from "@workspace/ui/components/theme-provider"

const systemQuery = "(prefers-color-scheme: dark)"
let changeSystemPreference: (dark: boolean) => void

function prepareTheme(storedTheme?: "dark" | "light") {
  const previousTheme = localStorage.getItem("theme")
  const originalMatchMedia = window.matchMedia
  const media = originalMatchMedia.call(window, systemQuery)
  let dark = false
  Object.defineProperty(media, "matches", {
    configurable: true,
    get: () => dark,
  })
  window.matchMedia = (query) =>
    query === systemQuery ? media : originalMatchMedia.call(window, query)
  changeSystemPreference = (nextDark) => {
    dark = nextDark
    media.dispatchEvent(
      new MediaQueryListEvent("change", { media: systemQuery, matches: dark })
    )
  }
  if (storedTheme) localStorage.setItem("theme", storedTheme)
  else localStorage.removeItem("theme")

  return () => {
    window.matchMedia = originalMatchMedia
    if (previousTheme === null) localStorage.removeItem("theme")
    else localStorage.setItem("theme", previousTheme)
  }
}

function ThemeControls() {
  const { theme, setTheme } = useTheme()
  // i18next-instrument-ignore
  return (
    <div className="grid max-w-md gap-4 bg-background p-6 text-foreground">
      <output aria-label="Selected theme">{theme}</output>
      <div className="flex gap-2">
        <Button onClick={() => setTheme("light")}>Light</Button>
        <Button onClick={() => setTheme("dark")}>Dark</Button>
        <Button onClick={() => setTheme("system")}>System</Button>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => changeSystemPreference(false)}>
          System prefers light
        </Button>
        <Button onClick={() => changeSystemPreference(true)}>
          System prefers dark
        </Button>
      </div>
      <input aria-label="Input target" className="border bg-background" />
      <textarea aria-label="Textarea target" className="border bg-background" />
      <select aria-label="Select target" className="border bg-background">
        <option>Option</option>
      </select>
      <div contentEditable suppressContentEditableWarning className="border">
        <span data-testid="editable-child">Editable target</span>
      </div>
    </div>
  )
}

const meta = {
  title: "UI/Theme provider",
  component: ThemeControls,
  beforeEach: () => prepareTheme(),
} satisfies Meta<typeof ThemeControls>

export default meta
type Story = StoryObj<typeof meta>

export const SystemPreference: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvasElement.ownerDocument.documentElement
    await expect(canvas.getByLabelText("Selected theme")).toHaveTextContent(
      "system"
    )
    await waitFor(() => expect(root).toHaveClass("light"))
    await expect(root.style.colorScheme).toBe("")

    await userEvent.click(
      canvas.getByRole("button", { name: "System prefers dark" })
    )
    await waitFor(() => expect(root).toHaveClass("dark"))
    await expect(canvas.getByLabelText("Selected theme")).toHaveTextContent(
      "system"
    )

    await userEvent.click(canvas.getByRole("button", { name: "Light" }))
    await userEvent.click(
      canvas.getByRole("button", { name: "System prefers light" })
    )
    await userEvent.click(
      canvas.getByRole("button", { name: "System prefers dark" })
    )
    await expect(root).toHaveClass("light")
    await userEvent.click(canvas.getByRole("button", { name: "System" }))
    await waitFor(() => expect(root).toHaveClass("dark"))
    await expect(localStorage.getItem("theme")).toBe("system")
  },
}

export const StoredPreference: Story = {
  beforeEach: () => prepareTheme("dark"),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvasElement.ownerDocument.documentElement
    await expect(canvas.getByLabelText("Selected theme")).toHaveTextContent(
      "dark"
    )
    await waitFor(() => expect(root).toHaveClass("dark"))
    await userEvent.click(canvas.getByRole("button", { name: "Light" }))
    await waitFor(() => expect(root).toHaveClass("light"))
    await expect(localStorage.getItem("theme")).toBe("light")
  },
}

export const KeyboardShortcut: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvasElement.ownerDocument.documentElement
    await userEvent.keyboard("d")
    await waitFor(() => expect(root).toHaveClass("dark"))
    await expect(localStorage.getItem("theme")).toBe("dark")
    await userEvent.keyboard("D")
    await waitFor(() => expect(root).toHaveClass("light"))
    await expect(localStorage.getItem("theme")).toBe("light")

    for (const modifier of ["Control", "Alt", "Meta"]) {
      await userEvent.keyboard(`{${modifier}>}d{/${modifier}}`)
      await expect(localStorage.getItem("theme")).toBe("light")
    }
    fireEvent.keyDown(window, { key: "d", repeat: true })
    await expect(localStorage.getItem("theme")).toBe("light")
    await userEvent.keyboard("x")
    await expect(localStorage.getItem("theme")).toBe("light")

    for (const label of ["Input target", "Textarea target", "Select target"]) {
      await userEvent.click(canvas.getByLabelText(label))
      await userEvent.keyboard("d")
      await expect(localStorage.getItem("theme")).toBe("light")
    }
    await userEvent.click(canvas.getByTestId("editable-child"))
    await userEvent.keyboard("d")
    await expect(localStorage.getItem("theme")).toBe("light")
    await expect(root).toHaveClass("light")
  },
}

export const StorageSynchronization: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const root = canvasElement.ownerDocument.documentElement
    const changeStorage = (key: string, value: string | null) => {
      const oldValue = localStorage.getItem(key)
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue,
          newValue: value,
          storageArea: localStorage,
        })
      )
    }

    changeStorage("theme", "dark")
    await waitFor(() => expect(root).toHaveClass("dark"))
    await expect(canvas.getByLabelText("Selected theme")).toHaveTextContent(
      "dark"
    )
    changeStorage("another-theme", "light")
    await expect(root).toHaveClass("dark")
    localStorage.removeItem("another-theme")
    changeStorage("theme", null)
    await waitFor(() => expect(root).toHaveClass("light"))
    await expect(canvas.getByLabelText("Selected theme")).toHaveTextContent(
      "system"
    )
  },
}
