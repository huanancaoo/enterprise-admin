import { createHash } from "node:crypto"

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function canonicalJsonHash(
  value: unknown,
  keyOrder: "code-unit" | "locale"
): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical)
    if (input && typeof input === "object") {
      return Object.fromEntries(
        (keyOrder === "locale"
          ? Object.keys(input).sort((a, b) => a.localeCompare(b))
          : Object.keys(input).sort()
        ).map((key) => [
          key,
          canonical((input as Record<string, unknown>)[key]),
        ])
      )
    }
    return input
  }
  // 两种排序已用于持久幂等指纹，调用方必须显式保留原协议。
  return hashJson(canonical(value))
}
