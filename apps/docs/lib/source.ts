import { llms, loader } from "fumadocs-core/source"
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons"
import { pageSchema } from "fumadocs-core/source/schema"
import { defineDocs } from "fumadocs-mdx/macro"
import { z } from "zod"
import { i18n } from "@/lib/i18n"
import { openapi } from "@/lib/openapi"
import { docsRoute } from "@/lib/shared"

export const docFrontmatterSchema = pageSchema.extend({
  category: z.enum([
    "getting-started",
    "architecture",
    "guides",
    "reference",
    "deployment",
    "contributing",
    "adr",
    "release-notes",
  ]),
  tags: z.array(z.string()),
  locale: z.enum(["en-US", "zh-CN"]),
  status: z.literal("published"),
})

const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: docFrontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export const source = loader(
  {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: "reference/api",
      groupBy: "tag",
    }),
  },
  {
    baseUrl: docsRoute,
    i18n,
    plugins: [lucideIconsPlugin(), openapi.loaderPlugin()],
  }
)

export const docsLlms = llms(source, {
  renderPage: async (page) => {
    if (page.type === "openapi") {
      return `# ${page.data.title} (${page.url})

\`\`\`json
${JSON.stringify(page.data.getSchema().bundled, null, 2)}
\`\`\``
    }

    return `# ${page.data.title} (${page.url})

${await page.data.getText("processed")}`
  },
})
