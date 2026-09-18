import { createUiI18n } from "@workspace/i18n"
import { UiI18nProvider } from "@workspace/i18n/react"
import {
  AdminDirectionProvider,
  ThemeProvider,
} from "@workspace/admin/workspace"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@workspace/ui/globals.css"
import { PlatformRouter } from "./platform-router"

const uiI18n = createUiI18n()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiI18nProvider instance={uiI18n}>
      <AdminDirectionProvider>
        <ThemeProvider>
          <PlatformRouter />
        </ThemeProvider>
      </AdminDirectionProvider>
    </UiI18nProvider>
  </StrictMode>
)
