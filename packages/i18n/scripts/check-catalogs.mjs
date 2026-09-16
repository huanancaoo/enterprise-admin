import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

// CLI status 报告提取键；这里同时拒绝主语言空值与有限动态键的漏译。
const root = new URL("../src/locales/", import.meta.url)
const locales = ["zh-CN", "en-US", "ar"]
const namespaces = [
  "common",
  "auth",
  "organization",
  "projects",
  "validation",
  "errors",
]
const errors = []
const placeholders = (value) =>
  [...value.matchAll(/{{\s*([^},\s]+)[^}]*}}/g)]
    .map((match) => match[1])
    .sort()
    .join(",")
for (const locale of locales) {
  const actual = readdirSync(new URL(`${locale}/`, root))
    .filter((name) => name.endsWith(".json"))
    .sort()
  if (
    JSON.stringify(actual) !==
    JSON.stringify(namespaces.map((ns) => `${ns}.json`).sort())
  )
    errors.push(`${locale}: namespace set drift`)
}
for (const namespace of namespaces) {
  const primary = JSON.parse(
    readFileSync(new URL(`zh-CN/${namespace}.json`, root), "utf8")
  )
  for (const locale of locales) {
    const url = new URL(`${locale}/${namespace}.json`, root)
    const catalog = JSON.parse(readFileSync(url, "utf8"))
    if (
      JSON.stringify(Object.keys(primary).sort()) !==
      JSON.stringify(Object.keys(catalog).sort())
    )
      errors.push(`${fileURLToPath(url)}: key set drift`)
    for (const [key, value] of Object.entries(catalog)) {
      if (typeof value !== "string" || !value.trim())
        errors.push(`${locale}/${namespace}:${key}: empty translation`)
      else if (
        typeof primary[key] === "string" &&
        placeholders(value) !== placeholders(primary[key])
      )
        errors.push(`${locale}/${namespace}:${key}: interpolation mismatch`)
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"))
  process.exitCode = 1
} else
  console.log(
    "Catalog namespaces, keys, non-empty values and interpolation parameters passed"
  )
