import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const scopes = ["apps/api/openapi", "packages/api-client/src/generated"]
function snapshot() {
  const files = new Map()
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else files.set(path, readFileSync(path, "utf8"))
    }
  }
  scopes.forEach(walk)
  return files
}
const before = snapshot()
execFileSync("pnpm", ["api:openapi"], { stdio: "inherit" })
execFileSync("pnpm", ["api:generate"], { stdio: "inherit" })
const after = snapshot()
const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
  (path) => before.get(path) !== after.get(path)
)
if (changed.length) {
  console.error(`API generated artifacts drifted:\n${changed.join("\n")}`)
  process.exitCode = 1
} else console.log("OpenAPI and Orval artifacts are reproducible")
