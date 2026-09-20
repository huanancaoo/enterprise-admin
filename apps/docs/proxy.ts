import { NextRequest, NextResponse } from "next/server"
import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation"
import { createI18nMiddleware } from "fumadocs-core/i18n/middleware"
import { docsContentRoute } from "@/lib/shared"
import { i18n } from "@/lib/i18n"

const i18nMiddleware = createI18nMiddleware(i18n)

const { rewrite: rewriteDocs } = rewritePath(
  `{/*path}`,
  `${docsContentRoute}{/*path}/content.md`
)
const { rewrite: rewriteSuffix } = rewritePath(
  `{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`
)

export default function proxy(
  request: NextRequest,
  event: Parameters<typeof i18nMiddleware>[1]
) {
  const result = rewriteSuffix(request.nextUrl.pathname)
  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl))
  }

  if (isMarkdownPreferred(request)) {
    const rewritten = rewriteDocs(request.nextUrl.pathname)

    if (rewritten) {
      return NextResponse.rewrite(new URL(rewritten, request.nextUrl), {
        headers: { Vary: "Accept" },
      })
    }
  }

  return i18nMiddleware(request, event)
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|llms\\.txt|llms-full\\.txt|static\\.json|og|llms\\.mdx).*)",
  ],
}
