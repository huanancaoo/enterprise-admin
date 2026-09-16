import { createUiI18n } from "@workspace/i18n"
import { UiI18nProvider } from "@workspace/i18n/react"
import { AdminDirectionProvider } from "@workspace/admin/workspace"
import { configureApiClient } from "@workspace/api-client"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { RouterProvider } from "@tanstack/react-router"
import { router } from "./router"
import { ThemeProvider } from "@/components/theme-provider.tsx"

const uiI18n = createUiI18n()

// 浏览器只访问同源代理；生成 SDK 的路径已含 /api/v1，不能把后端主机写进构建产物。
configureApiClient({ baseUrl: window.location.origin })

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
