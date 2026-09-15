import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const versions = JSON.parse(
  readFileSync("../../docs/architecture/versions.json")
)
assert.equal(
  process.versions.node,
  versions.node,
  "请使用仓库 .nvmrc 固定的 Node 版本"
)
assert.equal(
  spawnSync("pnpm", ["--version"], { encoding: "utf8" }).stdout.trim(),
  versions.pnpm
)
mkdirSync(".artifacts", { recursive: true })

function run(command, args) {
  console.log(`\nS0 > ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: "1" },
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`)
}

run("node", ["scripts/check-dependencies.mjs"])

// 最新基线必须实际提供原生 Standard Schema API，编译失败不能视为验收成功。
copyFileSync(
  "fixtures/native-standard-schema.ts.txt",
  ".artifacts/native-standard-schema.ts"
)
const native = spawnSync(
  "tsc",
  [
    "--ignoreConfig",
    "--noEmit",
    "--skipLibCheck",
    "--strict",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    ".artifacts/native-standard-schema.ts",
  ],
  { encoding: "utf8" }
)
if (native.error) throw native.error
assert.equal(native.status, 0, native.stdout + native.stderr)
writeFileSync(
  ".artifacts/native-standard-schema.log",
  native.stdout + native.stderr
)

run("auth", [
  "generate",
  "--config",
  "backend/auth-cli.ts",
  "--output",
  ".artifacts/auth-schema.ts",
  "--yes",
])
assert.equal(
  readFileSync(".artifacts/auth-schema.ts", "utf8"),
  readFileSync("backend/auth-schema.ts", "utf8"),
  "认证 Schema 与配置发生漂移"
)
run("pnpm", ["run", "test:backend"])
run("pnpm", ["run", "i18n:check"])
run("msw", ["init", "public", "--no-save"])
run("pnpm", ["run", "typecheck"])
run("pnpm", ["run", "test:stories"])
run("pnpm", ["run", "build:stories"])
console.log(
  "\nPASS S0: 版本、认证/组织/UUID、Zod/OpenAPI/Orval、Storybook/MSW、i18n 验证全部通过"
)
