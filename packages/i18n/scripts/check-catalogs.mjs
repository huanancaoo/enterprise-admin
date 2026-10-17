import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

// CLI status 报告提取键；这里同时拒绝主语言空值与有限动态键的漏译。
const root = new URL("../src/locales/", import.meta.url)
const locales = ["zh-CN", "en-US", "ar"]
const namespaces = [
  "common",
  "files",
  "auth",
  "organization",
  "projects",
  "settings",
  "notifications",
  "tasks",
  "webhooks",
  "credentials",
  "identity",
  "validation",
  "errors",
  "system",
  "catalogs",
  "employees",
  "roles",
  "announcements",
  "platformTasks",
]
const errors = []
const pluralSuffix = /_(zero|one|two|few|many|other)$/
const messageKey = (key) => key.replace(pluralSuffix, "")
const semanticKeys = (catalog) =>
  [...new Set(Object.keys(catalog).map(messageKey))].sort()
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
      JSON.stringify(semanticKeys(primary)) !==
      JSON.stringify(semanticKeys(catalog))
    )
      errors.push(`${fileURLToPath(url)}: key set drift`)
    // 阿拉伯语需要六种基数形式；按消息语义比较集合，再独立检查各语言的 CLDR 形式。
    const pluralMessages = new Set(
      Object.keys(primary)
        .filter((key) => pluralSuffix.test(key))
        .map(messageKey)
    )
    for (const key of pluralMessages) {
      for (const category of new Intl.PluralRules(locale).resolvedOptions()
        .pluralCategories) {
        if (!Object.hasOwn(catalog, `${key}_${category}`))
          errors.push(
            `${locale}/${namespace}:${key}_${category}: missing plural translation`
          )
      }
    }
    for (const [key, value] of Object.entries(catalog)) {
      const primaryValue = pluralSuffix.test(key)
        ? primary[`${messageKey(key)}_other`]
        : primary[key]
      if (typeof value !== "string" || !value.trim())
        errors.push(`${locale}/${namespace}:${key}: empty translation`)
      else if (
        typeof primaryValue === "string" &&
        placeholders(value) !== placeholders(primaryValue)
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
