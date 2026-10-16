import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { frontmatter } from "fumadocs-core/content/md/frontmatter"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import remarkMdx from "remark-mdx"
import { visit } from "unist-util-visit"
import { z } from "zod"

const required = [
  "title",
  "description",
  "category",
  "tags",
  "locale",
  "status",
]
const localeByFile = (file) => (file.endsWith(".zh-CN.mdx") ? "zh-CN" : "en-US")
const metadataSchema = z.record(z.string(), z.unknown())
// 正文构建使用 MDX；表达式和 JSX 属性中的字符串不属于 Markdown 链接。
const markdown = remark().use(remarkGfm).use(remarkMdx)

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

function isMissingMetadata(value) {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
}

function pageKey(root, file) {
  return relative(root, file)
    .replace(/\.zh-CN\.mdx$/, "")
    .replace(/\.mdx$/, "")
}

export function checkContent(root) {
  const files = walk(root).filter((file) => extname(file) === ".mdx")
  const errors = []
  const english = files.filter((file) => !file.endsWith(".zh-CN.mdx"))
  const chinese = new Set(
    files
      .filter((file) => file.endsWith(".zh-CN.mdx"))
      .map((file) => pageKey(root, file))
  )

  for (const file of english) {
    if (!chinese.has(pageKey(root, file))) {
      errors.push(`${relative(root, file)}: missing zh-CN translation`)
    }
  }

  for (const file of files) {
    const rel = relative(root, file)
    const source = readFileSync(file, "utf8")
    let parsed
    try {
      parsed = frontmatter(source)
    } catch {
      errors.push(`${rel}: invalid frontmatter`)
      continue
    }
    if (!parsed.matter) {
      errors.push(`${rel}: missing frontmatter`)
      continue
    }
    const metadata = metadataSchema.safeParse(parsed.data)
    if (!metadata.success) {
      errors.push(`${rel}: invalid frontmatter`)
      continue
    }
    const data = metadata.data
    const locale = localeByFile(file)
    for (const field of required) {
      if (isMissingMetadata(data[field])) {
        errors.push(`${rel}: missing ${field}`)
      }
    }
    if (!isMissingMetadata(data.locale) && data.locale !== locale) {
      errors.push(`${rel}: locale ${data.locale} does not match file`)
    }
    if (!isMissingMetadata(data.status) && data.status !== "published") {
      errors.push(`${rel}: status must be published`)
    }
    let tree
    try {
      tree = markdown.parse(parsed.content)
    } catch {
      errors.push(`${rel}: invalid MDX`)
      continue
    }
    const definitions = new Map()
    // 同名定义采用首个；只有被实际引用的定义才参与链接检查。
    visit(tree, "definition", (node) => {
      if (!definitions.has(node.identifier))
        definitions.set(node.identifier, node.url)
    })
    visit(
      tree,
      ["link", "image", "linkReference", "imageReference"],
      (node) => {
        const href =
          node.type === "link" || node.type === "image"
            ? node.url
            : definitions.get(node.identifier)
        if (!href || href.startsWith("#") || /^(https?:|mailto:|\/)/.test(href))
          return
        try {
          const target = fileURLToPath(new URL(href, pathToFileURL(file)))
          if (!statSync(target).isFile())
            errors.push(`${rel}: broken link ${href}`)
        } catch {
          errors.push(`${rel}: broken link ${href}`)
        }
      }
    )
  }

  return { files, errors }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../content/docs"
  )
  const { files, errors } = checkContent(root)
  if (errors.length) {
    console.error(errors.join("\n"))
    process.exitCode = 1
  } else {
    console.log(`Content checks passed: ${files.length} pages`)
  }
}
