import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const required = [
  "title",
  "description",
  "category",
  "tags",
  "locale",
  "status",
]
const localeByFile = (file) => (file.endsWith(".zh-CN.mdx") ? "zh-CN" : "en-US")

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else out.push(path)
  }
  return out
}

function parseFrontmatter(source) {
  if (!source.startsWith("---\n")) return null
  const end = source.indexOf("\n---\n", 4)
  if (end === -1) return null
  const body = source.slice(4, end)
  const data = {}
  let key
  for (const line of body.split("\n")) {
    if (line.startsWith("  - ")) {
      if (!Array.isArray(data[key])) data[key] = []
      data[key].push(line.slice(4).replace(/^["']|["']$/g, ""))
      continue
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    key = match[1]
    const raw = match[2]
    data[key] = raw === "" ? [] : raw.replace(/^["']|["']$/g, "")
  }
  return { data, markdown: source.slice(end + 5) }
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
    const parsed = parseFrontmatter(readFileSync(file, "utf8"))
    if (!parsed) {
      errors.push(`${rel}: missing frontmatter`)
      continue
    }
    const locale = localeByFile(file)
    for (const field of required) {
      if (
        parsed.data[field] === undefined ||
        parsed.data[field] === "" ||
        (Array.isArray(parsed.data[field]) && parsed.data[field].length === 0)
      ) {
        errors.push(`${rel}: missing ${field}`)
      }
    }
    if (parsed.data.locale && parsed.data.locale !== locale) {
      errors.push(`${rel}: locale ${parsed.data.locale} does not match file`)
    }
    if (parsed.data.status && parsed.data.status !== "published") {
      errors.push(`${rel}: status must be published`)
    }
    const linkPattern = /\[[^\]]*]\(([^)]+)\)/g
    let match
    while ((match = linkPattern.exec(parsed.markdown))) {
      const href = match[1].split("#")[0].split(" ")[0]
      if (!href || /^(https?:|mailto:|\/)/.test(href)) continue
      const target = resolve(dirname(file), href)
      try {
        if (!statSync(target).isFile())
          errors.push(`${rel}: broken link ${href}`)
      } catch {
        errors.push(`${rel}: broken link ${href}`)
      }
    }
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
