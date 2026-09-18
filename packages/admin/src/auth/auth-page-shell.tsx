import type { ReactNode } from "react"
import { GalleryVerticalEnd } from "lucide-react"
import { LocaleSwitcher } from "../components/workspace"

export function AuthPageShell({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GalleryVerticalEnd className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              {title}
            </span>
          </div>
          <LocaleSwitcher align="end" />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-xs">{children}</div>
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
