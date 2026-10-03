import type { ReactNode } from "react"
import { GalleryVerticalEnd } from "lucide-react"
import { useDocumentTitle } from "../hooks/use-document-title"
import { LocaleSwitcher } from "../components/workspace"

export function AuthPageShell({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  useDocumentTitle(title)
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-6 p-6 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 font-medium">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" aria-hidden="true" />
            </div>
            <span className="text-sm font-semibold tracking-tight wrap-anywhere">
              {title}
            </span>
          </div>
          <LocaleSwitcher align="end" />
        </div>
        <div className="flex flex-1 items-center justify-center py-8 sm:py-12">
          <div className="w-full max-w-sm min-w-0">{children}</div>
        </div>
      </div>
      <div className="relative hidden bg-muted lg:block">
        <img
          src="/placeholder.svg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </main>
  )
}
