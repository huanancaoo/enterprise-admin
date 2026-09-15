import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "@workspace/ui/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="mx-auto max-w-3xl space-y-4 p-12">
      <h1 className="text-3xl font-semibold">平台后台</h1>
      <p className="text-muted-foreground">平台应用入口已就绪。</p>
    </main>
  </StrictMode>
)
