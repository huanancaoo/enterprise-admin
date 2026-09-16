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
    write("package.json", JSON.stringify({ name: "fixture", private: true }))
    write("pnpm-workspace.yaml", 'packages:\n  - "apps/*"\n  - "packages/*"\n')
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

function withWorkspace(patterns, run) {
  const root = mkdtempSync(join(tmpdir(), "workspace-boundaries-"))
  const write = (path, content) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const pkg = (path, name, manifest = {}) => {
    write(`${path}/package.json`, JSON.stringify({ name, ...manifest }))
    write(`${path}/src/index.ts`, "export {}")
  }
  try {
    write("package.json", JSON.stringify({ name: "fixture", private: true }))
    write(
      "pnpm-workspace.yaml",
      `packages:\n${patterns.map((pattern) => `  - ${JSON.stringify(pattern)}`).join("\n")}\n`
    )
    run({ root, write, pkg })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("新增 workspace 即使尚未被依赖，也必须声明边界策略", () => {
  withWorkspace(
    ["apps/*", "packages/*", "extensions/**", "!extensions/excluded"],
    ({ root, pkg }) => {
      pkg("apps/admin", "admin")
      pkg("extensions/excluded", "excluded")
      assert.deepEqual(checkBoundaries(root), [])
      pkg("extensions/nested/new-package", "new-package")
      assert.deepEqual(checkBoundaries(root), [
        "extensions/nested/new-package/package.json: workspace package has no dependency boundary policy",
      ])
    }
  )
})

test("未登记包不能通过源码导入、路径别名或 manifest 绕过边界", () => {
  withWorkspace(["apps/*", "packages/*"], ({ root, write, pkg }) => {
    pkg("apps/admin", "admin")
    pkg("packages/new-server", "@workspace/new-server")
    write(
      "apps/admin/tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          paths: { "@new-server": ["../../packages/new-server/src/index.ts"] },
        },
      })
    )
    for (const source of [
      'import "@workspace/new-server"',
      'export * from "@workspace/new-server/subpath"',
      'import("@workspace/new-server")',
      'require("@workspace/new-server")',
      'type Server = import("@workspace/new-server")',
      'import "../../../packages/new-server/src/index"',
      'import "@new-server"',
    ]) {
      write("apps/admin/src/index.ts", source)
      const errors = checkBoundaries(root)
      assert.equal(errors.length, 2, source)
      assert.ok(
        errors.some((error) =>
          error.includes("violates apps/admin dependency boundary")
        ),
        source
      )
    }
    write("apps/admin/src/index.ts", "export {}")
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      pkg("apps/admin", "admin", {
        [section]: { "@workspace/new-server": "workspace:*" },
      })
      assert.equal(checkBoundaries(root).length, 2, section)
    }
  })
})

test("嵌套 workspace 使用自身包边界，不被父包的合法依赖掩盖", () => {
  withWorkspace(["apps/*", "packages/**"], ({ root, write, pkg }) => {
    pkg("apps/admin", "admin")
    pkg("packages/ui", "@workspace/ui")
    pkg("packages/ui/nested", "nested")
    write("packages/ui/nested/src/index.ts", 'import "drizzle-orm"')
    write(
      "apps/admin/src/index.ts",
      'import "../../../packages/ui/nested/src/index"'
    )
    const errors = checkBoundaries(root)
    assert.equal(errors.length, 2)
    assert.ok(
      errors.some((error) =>
        error.includes("violates apps/admin dependency boundary")
      )
    )
    assert.ok(
      errors.some((error) =>
        error.startsWith("packages/ui/nested/package.json:")
      )
    )
  })
})

test("租户 Repository 禁止导入 Pool、db 工厂和租户事务运行入口", () => {
  withWorkspace(["packages/*"], ({ root, write, pkg }) => {
    pkg("packages/database", "@workspace/database")
    write(
      "packages/database/src/tenant.ts",
      "export type TenantTx = {}; export function createTenantRunner() {}"
    )
    write(
      "packages/database/src/schema/projects.ts",
      "export const projects = {}"
    )
    const file = "packages/database/src/repositories/projects.ts"
    write(
      file,
      'import type { TenantTx } from "../tenant.ts"; import { projects } from "../schema/projects.ts"; import { eq } from "drizzle-orm"'
    )
    assert.deepEqual(checkBoundaries(root), [])
    for (const source of [
      'import { Pool } from "pg"',
      'import { drizzle } from "drizzle-orm/node-postgres"',
      'import { createDatabase } from "../index.ts"',
      'import { createTenantRunner } from "../tenant.ts"',
      'import("../index.ts")',
      'export * from "../index.ts"',
    ]) {
      write(file, source)
      assert.ok(
        checkBoundaries(root).some((error) =>
          error.includes("TenantTx repository boundary")
        ),
        source
      )
    }
  })
})

test("区分同名 npm 工具和 workspace 应用，仍拒绝应用间源码依赖", () => {
  withWorkspace(["apps/*"], ({ root, write, pkg }) => {
    pkg("apps/admin", "admin", { devDependencies: { storybook: "10.6.0" } })
    pkg("apps/storybook", "storybook")
    write("apps/admin/src/index.ts", 'import "storybook/test"')
    assert.deepEqual(checkBoundaries(root), [])
    write("apps/admin/src/index.ts", 'import "../../storybook/src/index"')
    assert.equal(checkBoundaries(root).length, 1)
    write("apps/admin/src/index.ts", 'import "storybook/test"')
    pkg("apps/admin", "admin", {
      devDependencies: { storybook: "workspace:*" },
    })
    assert.equal(checkBoundaries(root).length, 1)
  })
})

test("本地 file/link 依赖不能以显式版本名绕过边界", () => {
  withWorkspace(["apps/*", "packages/*"], ({ root, pkg }) => {
    pkg("packages/database", "@workspace/database")
    for (const protocol of ["file", "link"]) {
      pkg("apps/admin", "admin", {
        dependencies: {
          "@workspace/database": `${protocol}:../../packages/database`,
        },
      })
      assert.equal(checkBoundaries(root).length, 1)
    }
  })
})
