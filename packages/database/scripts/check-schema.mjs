import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dir = mkdtempSync(join(tmpdir(), "enterprise-auth-schema-"))
try {
  const output = join(dir, "auth.ts")
  execFileSync(
    "pnpm",
    [
      "exec",
      "auth",
      "generate",
      "--config",
      "auth.config.ts",
      "--output",
      output,
      "--yes",
    ],
    { stdio: "inherit" }
  )
  assert.equal(
    readFileSync(output, "utf8"),
    readFileSync("src/schema/auth.ts", "utf8"),
    "认证 Schema 与配置发生漂移，请运行 pnpm db:generate"
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
