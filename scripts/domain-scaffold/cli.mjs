#!/usr/bin/env node
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { readFile, readdir, writeFile, rm, mkdtemp, cp } from "node:fs/promises"
import { join, relative } from "node:path"
import { checkPath, planDomain, writePlan } from "./generate.mjs"
import { accessSql } from "./templates.mjs"

const exec = promisify(execFile)
async function command(root, args) {
  const child = exec("pnpm", args, { cwd: root, maxBuffer: 8 * 1024 * 1024 })
  child.child.stdout?.pipe(process.stdout)
  child.child.stderr?.pipe(process.stderr)
  return child
}
// Drizzle 会合并全部未迁移 Schema；先在临时 out 验证基线，防止把其他开发中的表卷入新领域。
export async function assertSchemaCurrent(root, run = command) {
  await checkPath(root, "packages/database/migrations/meta/_journal.json")
  await checkPath(root, "packages/database/src/schema/auth.ts")
  await run(root, ["db:check"])
  const probe = await mkdtemp(
    join(root, "packages/database/.domain-scaffold-probe-")
  )
  try {
    const output = join(probe, "migrations")
    await cp(join(root, "packages/database/migrations"), output, {
      recursive: true,
    })
    const journal = join(output, "meta/_journal.json")
    const before = await readFile(journal, "utf8")
    const configPath = join(probe, "drizzle.config.cjs")
    await writeFile(
      configPath,
      "module.exports = " +
        JSON.stringify({
          dialect: "postgresql",
          schema: join(root, "packages/database/src/schema/*.ts"),
          out: relative(join(root, "packages/database"), output),
        })
    )
    const result = await run(root, [
      "--filter",
      "@workspace/database",
      "exec",
      "drizzle-kit",
      "generate",
      `--config=${configPath}`,
    ])
    if ((await readFile(journal, "utf8")) !== before)
      throw new Error(
        "existing business Schema drift: generate and review its migrations before creating a domain"
      )
    // 此版本 Drizzle 的部分异常仍返回 0；必须取得明确的无变更确认，不能以未写 ledger 推断成功。
    if (!result?.stdout?.includes("No schema changes, nothing to migrate"))
      throw new Error("Drizzle baseline probe did not confirm a clean Schema")
  } finally {
    await rm(probe, { recursive: true, force: true })
  }
}

// 迁移由官方生成链分配编号和快照；CLI 只填入本生成器固定构建的 RLS，不执行迁移。
export async function generateMigrations(root, config, run = command) {
  const directory = join(root, "packages/database/migrations")
  await checkPath(root, "packages/database/migrations")
  await checkPath(root, "packages/database/src/schema/auth.ts")
  const original = new Map()
  async function snapshot(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`migration target is a symbolic link: ${path}`)
      if (entry.isDirectory()) await snapshot(path)
      else original.set(path, await readFile(path))
    }
  }
  await snapshot(directory)
  const authPath = join(root, "packages/database/src/schema/auth.ts")
  const auth = await readFile(authPath)
  try {
    await run(root, ["db:generate"])
    if (!(await readFile(authPath)).equals(auth))
      throw new Error(
        "authentication Schema drift: resolve db:check before creating a domain"
      )
    const ledgerPath = join(directory, "meta/_journal.json")
    const structure = JSON.parse(await readFile(ledgerPath, "utf8"))
    const previous = JSON.parse(original.get(ledgerPath).toString("utf8"))
    if (structure.entries.length !== previous.entries.length + 1)
      throw new Error(
        "structure migration did not append exactly one ledger entry"
      )
    const generatedSql = await readFile(
      join(directory, structure.entries.at(-1).tag + ".sql"),
      "utf8"
    )
    if (!generatedSql.includes('CREATE TABLE "' + config.table + '"'))
      throw new Error(
        "structure migration does not create the declared domain table"
      )
    await run(root, [
      "--filter",
      "@workspace/database",
      "exec",
      "drizzle-kit",
      "generate",
      "--custom",
      `--name=${config.domain}-access`,
    ])
    const journal = JSON.parse(await readFile(ledgerPath, "utf8"))
    if (journal.entries.length !== structure.entries.length + 1)
      throw new Error(
        "custom migration did not append exactly one ledger entry"
      )
    const entry = journal.entries.at(-1)
    if (!entry.tag.endsWith(`_${config.domain}-access`))
      throw new Error(
        "custom migration name does not match the generated domain"
      )
    await writeFile(join(directory, `${entry.tag}.sql`), accessSql(config))
  } catch (error) {
    // 失败只撤销这次生成的 migration；已存在 migration 的字节和 ledger 必须原样保留。
    async function restore(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await restore(path)
        else if (!original.has(path)) await rm(path)
      }
    }
    await restore(directory)
    for (const [path, content] of original) await writeFile(path, content)
    await writeFile(authPath, auth)
    throw error
  }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "pnpm domain:create --config <declaration.json> [--dry-run]\n生成普通租户领域源码与正式 Drizzle/RLS 迁移，不执行数据库迁移。"
    )
    return
  }
  const configIndex = args.indexOf("--config")
  const dryRun = args.includes("--dry-run")
  if (
    configIndex !== 0 ||
    !args[1] ||
    args[1].startsWith("--") ||
    args.length !== (dryRun ? 3 : 2) ||
    (dryRun && args[2] !== "--dry-run")
  )
    throw new Error(
      "usage: pnpm domain:create --config <declaration.json> [--dry-run]"
    )
  const plan = await planDomain(
    process.cwd(),
    JSON.parse(await readFile(args[1], "utf8"))
  )
  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          domain: plan.config.domain,
          files: [...plan.files.keys()],
          migrations: "Drizzle structure + custom RLS (not executed)",
        },
        null,
        2
      )
    )
    return
  }
  await writePlan(
    plan,
    async () => {
      await generateMigrations(plan.root, plan.config)
    },
    async () => {
      await assertSchemaCurrent(plan.root)
    }
  )
  console.log(
    `已生成 ${plan.config.domain}。数据库尚未执行迁移。接下来运行：\npnpm --filter @workspace/i18n exec i18next-cli types\npnpm api:openapi\npnpm api:generate\npnpm db:check\npnpm lint:boundaries\npnpm typecheck\n按 docs/guides/create-domain-module.md 验证并应用迁移。`
  )
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
)
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
