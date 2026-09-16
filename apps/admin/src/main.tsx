import { createUiI18n } from "@workspace/i18n"
import { UiI18nProvider } from "@workspace/i18n/react"
import { AdminDirectionProvider } from "@workspace/admin/workspace"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { RouterProvider } from "@tanstack/react-router"
import { router } from "./router"
import { ThemeProvider } from "@/components/theme-provider.tsx"

const uiI18n = createUiI18n()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiI18nProvider instance={uiI18n}>
      <AdminDirectionProvider>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </AdminDirectionProvider>
    </UiI18nProvider>
  </StrictMode>
)
