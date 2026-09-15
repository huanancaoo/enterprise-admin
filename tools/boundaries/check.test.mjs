import { test } from "vitest"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkBoundaries } from "./check.mjs"

test("拒绝前端数据库依赖，包括相对路径、动态导入和契约层穿透", () => {
  const root = mkdtempSync(join(tmpdir(), "s1-boundaries-"))
  const write = (path, text) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  try {
    for (const [path, name] of [
      ["apps/admin", "admin"],
      ["packages/database", "@workspace/database"],
      ["packages/contracts", "@workspace/contracts"],
      ["packages/ui", "@workspace/ui"],
    ]) {
      write(`${path}/package.json`, JSON.stringify({ name }))
      write(`${path}/src/index.ts`, "export {}")
    }
    write("apps/admin/src/index.ts", 'import "@workspace/ui"')
    assert.deepEqual(checkBoundaries(root), [])
    for (const source of [
      'import "@workspace/database"',
      'import "../../../packages/database/src/index"',
      'import("@workspace/database")',
      'type DB = import("@workspace/database")',
    ]) {
      write("apps/admin/src/index.ts", source)
      assert.equal(checkBoundaries(root).length, 1, source)
    }
    write("apps/admin/src/index.ts", 'import "@workspace/contracts"')
    write("packages/contracts/src/index.ts", 'import "drizzle-orm"')
    assert.equal(checkBoundaries(root).length, 1)
    write("packages/contracts/src/index.ts", "export {}")
    write(
      "apps/admin/package.json",
      JSON.stringify({
        name: "admin",
        dependencies: { "@workspace/database": "workspace:*" },
      })
    )
    assert.equal(checkBoundaries(root).length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
