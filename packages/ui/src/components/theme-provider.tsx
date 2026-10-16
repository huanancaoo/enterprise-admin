/* eslint-disable react-refresh/only-export-components */
import * as React from "react"
import {
  ThemeProvider as NextThemeProvider,
  useTheme as useNextTheme,
} from "next-themes"

export type Theme = "dark" | "light" | "system"
export type ResolvedTheme = "dark" | "light"

export type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
  disableTransitionOnChange?: boolean
}

export type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  )
}

function ThemeKeyboardShortcut() {
  const { resolvedTheme, setTheme } = useNextTheme()

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target) ||
        event.key.toLowerCase() !== "d"
      ) {
        return
      }

      // 系统模式下按当前实际配色反转，并将用户选择持久化为显式主题。
      setTheme(resolvedTheme === "dark" ? "light" : "dark")
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [resolvedTheme, setTheme])

  return null
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  disableTransitionOnChange = true,
}: ThemeProviderProps) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme={defaultTheme}
      storageKey={storageKey}
      disableTransitionOnChange={disableTransitionOnChange}
      // 保持现有原生控件外观，避免主题库同时写入 color-scheme。
      enableColorScheme={false}
    >
      <ThemeKeyboardShortcut />
      {children}
    </NextThemeProvider>
  )
}

export function useTheme(): ThemeProviderState {
  const { theme, setTheme } = useNextTheme()

  if (theme === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider")
  }

  return { theme: theme as Theme, setTheme }
}
