import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { RouterProvider } from "@tanstack/react-router"
import { router } from "./router"
import { ThemeProvider } from "@/components/theme-provider.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>
)
