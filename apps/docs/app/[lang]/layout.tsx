import { RootProvider } from "fumadocs-ui/provider/next"
import { Inter, Noto_Sans_SC } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import { i18nProvider } from "fumadocs-ui/i18n"
import { DocsLayout } from "fumadocs-ui/layouts/docs"
import { MessageCircleIcon } from "lucide-react"
import { source } from "@/lib/source"
import { translations, baseOptions } from "@/lib/layout.shared"
import { isLocale } from "@/lib/i18n"
import { notFound } from "next/navigation"
import SearchDialog from "@/components/search-dialog"
import {
  AISearch,
  AISearchPanel,
  AISearchTrigger,
} from "@/components/ai/search"
import { cn } from "@/lib/cn"
import { buttonVariants } from "fumadocs-ui/components/ui/button"
import "../global.css"

const inter = Inter({
  subsets: ["latin"],
})

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
})

export default async function Layout({
  params,
  children,
}: LayoutProps<"/[lang]">) {
  const { lang } = await params
  if (!isLocale(lang)) notFound()

  const isZh = lang === "zh-CN"

  return (
    <html
      lang={lang}
      className={isZh ? notoSansSC.className : inter.className}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider
          i18n={i18nProvider(translations, lang)}
          search={{ SearchDialog }}
        >
          <DocsLayout tree={source.getPageTree(lang)} {...baseOptions(lang)}>
            <AISearch>
              <AISearchPanel />
              <AISearchTrigger
                position="float"
                className={cn(
                  buttonVariants({
                    variant: "secondary",
                    className: "text-fd-muted-foreground rounded-2xl",
                  })
                )}
              >
                <MessageCircleIcon className="size-4.5" />
                {isZh ? "询问文档" : "Ask AI"}
              </AISearchTrigger>
            </AISearch>
            {children}
          </DocsLayout>
        </RootProvider>
        <Analytics />
      </body>
    </html>
  )
}
