const actions = ["read", "create", "delete"]
export const locales = ["zh-CN", "en-US", "ar"]
const identifier = /^[a-z][a-z0-9]{1,39}$/
const reserved = new Set([
  "user",
  "account",
  "session",
  "organization",
  "member",
  "invitation",
  "role",
  "project",
  "file",
  "folder",
  "audit",
  "tenantSettings",
  "integration",
  "platform",
  "task",
  "notification",
  "announcement",
  "access",
  "ac",
  "team",
  "constructor",
  "prototype",
  "class",
  "const",
  "let",
  "var",
  "function",
  "new",
  "delete",
  "return",
  "default",
  "import",
  "export",
  "super",
  "this",
  "null",
  "true",
  "false",
  "void",
  "type",
  "interface",
  "enum",
  "namespace",
  "declare",
  "yield",
  "await",
])

function object(value, keys, path) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${path}: expected exactly ${keys.join(", ")}`)
}
function grants(value, path) {
  if (
    !Array.isArray(value) ||
    value.some((item) => !actions.includes(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${path}: expected distinct read/create/delete actions`)
  return actions.filter((action) => value.includes(action))
}
export function parseConfig(input) {
  object(
    input,
    [
      "version",
      "domain",
      "entity",
      "table",
      "name",
      "grants",
      "delegable",
      "labels",
    ],
    "config"
  )
  if (input.version !== 1) throw new Error("config.version: expected 1")
  for (const key of ["domain", "entity", "table"])
    if (
      typeof input[key] !== "string" ||
      !identifier.test(input[key]) ||
      reserved.has(input[key])
    )
      throw new Error(
        `config.${key}: expected a non-reserved lowercase identifier (2–40 characters)`
      )
  if (input.entity === input.domain)
    throw new Error("entity and domain must differ (singular and plural)")
  object(input.name, ["minLength", "maxLength"], "config.name")
  if (
    !Number.isInteger(input.name.minLength) ||
    !Number.isInteger(input.name.maxLength) ||
    input.name.minLength < 1 ||
    input.name.maxLength < input.name.minLength ||
    input.name.maxLength > 4096
  )
    throw new Error("config.name: expected 1 <= minLength <= maxLength <= 4096")
  object(input.grants, ["owner", "admin", "member"], "config.grants")
  const roleGrants = Object.fromEntries(
    Object.entries(input.grants).map(([role, value]) => [
      role,
      grants(value, `config.grants.${role}`),
    ])
  )
  const delegable = grants(input.delegable, "config.delegable")
  object(input.labels, locales, "config.labels")
  for (const locale of locales) {
    object(input.labels[locale], ["title", "name"], `config.labels.${locale}`)
    for (const value of Object.values(input.labels[locale]))
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 160 ||
        /[\u0000-\u001f]/.test(value)
      )
        throw new Error(
          `config.labels.${locale}: expected nonempty display labels without control characters`
        )
  }
  return { ...input, grants: roleGrants, delegable }
}
