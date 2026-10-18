import * as prettier from "prettier"
import {
  readFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  rename,
  open,
  realpath,
  rmdir,
} from "node:fs/promises"
import { dirname, resolve, join, relative, sep } from "node:path"
import { parseConfig, locales } from "./config.mjs"
import { testTemplates } from "./test-templates.mjs"
import { templates } from "./templates.mjs"
import { integrationPaths, register, registerJson } from "./registry.mjs"

const missing = async (path) => {
  try {
    await lstat(path)
    return false
  } catch (error) {
    if (error.code === "ENOENT") return true
    throw error
  }
}
export async function checkPath(root, path) {
  const target = resolve(root, path)
  if (
    relative(root, target) === ".." ||
    relative(root, target).startsWith(".." + sep) ||
    target === root
  )
    throw new Error(`path outside repository: ${path}`)
  let current = root
  for (const part of relative(root, target).split(sep)) {
    current = join(current, part)
    if (await missing(current)) break
    if ((await lstat(current)).isSymbolicLink())
      throw new Error(`generation target is a symbolic link: ${current}`)
  }
  return target
}
export async function planDomain(root, rawConfig) {
  root = await realpath(root)
  const config = parseConfig(rawConfig)
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  )
  if (manifest.name !== "enterprise-admin")
    throw new Error("run from the enterprise-admin repository root")
  const files = new Map([...templates(config), ...testTemplates(config)])
  const original = new Map()
  for (const path of files.keys()) {
    await checkPath(root, path)
    if (!(await missing(join(root, path))))
      throw new Error(`generation target already exists: ${path}`)
    original.set(path, null)
  }
  // 数据库和权限命名不能仅以目标文件名判断，现有 SQL 表可能在另一 Schema 文件定义。
  const { readdir } = await import("node:fs/promises")
  for (const file of await readdir(
    join(root, "packages/database/src/schema")
  )) {
    if (!file.endsWith(".ts")) continue
    const text = await readFile(
      join(root, "packages/database/src/schema", file),
      "utf8"
    )
    if (new RegExp(`pgTable\\(\\s*["']${config.table}["']`).test(text))
      throw new Error(`database table already exists: ${config.table}`)
  }
  const paths = [
    ...integrationPaths,
    "packages/database/package.json",
    ...locales.map(
      (locale) => `packages/i18n/src/locales/${locale}/organization.json`
    ),
  ]
  for (const path of paths) {
    await checkPath(root, path)
    const text = await readFile(join(root, path), "utf8")
    original.set(path, text)
    files.set(
      path,
      path.endsWith(".json")
        ? registerJson(path, text, config)
        : register(path, text, config)
    )
  }
  // 格式化和语法检查也在发布前完成，任何模板错误都不能留下半成品源码。
  for (const [path, content] of files) {
    const options = await prettier.resolveConfig(join(root, path))
    files.set(
      path,
      await prettier.format(content, { ...options, filepath: join(root, path) })
    )
  }
  return { root, config, files, original }
}
export async function writePlan(
  plan,
  afterWrite = async () => {},
  beforeWrite = async () => {}
) {
  const { root, files, original } = plan
  const lock = join(root, ".domain-scaffold.lock")
  const handle = await open(lock, "wx")
  let stage
  const written = []
  const directories = []
  try {
    stage = await mkdtemp(join(root, ".domain-scaffold-stage-"))
    await beforeWrite()
    for (const [path, content] of files) {
      await checkPath(root, path)
      const expected = original.get(path)
      const current = (await missing(join(root, path)))
        ? null
        : await readFile(join(root, path), "utf8")
      if (current !== expected)
        throw new Error(`generation target changed after planning: ${path}`)
      await mkdir(dirname(join(stage, "next", path)), { recursive: true })
      await writeFile(join(stage, "next", path), content)
      if (expected !== null) {
        await mkdir(dirname(join(stage, "original", path)), { recursive: true })
        await writeFile(join(stage, "original", path), expected)
      }
    }
    // 所有冲突在写业务源码前确认；临时文件与目标位于同一文件系统，以 rename 发布每个文件。
    for (const path of files.keys()) {
      const target = join(root, path)
      let parent = dirname(target)
      const pending = []
      while (await missing(parent)) {
        pending.push(parent)
        parent = dirname(parent)
      }
      for (const dir of pending.reverse()) {
        await mkdir(dir)
        directories.push(dir)
      }
      await rename(join(stage, "next", path), target)
      written.push(path)
    }
    await afterWrite()
  } catch (error) {
    for (const path of written.reverse()) {
      const previous = original.get(path)
      if (previous === null) await rm(join(root, path))
      else await rename(join(stage, "original", path), join(root, path))
    }
    for (const dir of directories.reverse()) await rmdir(dir)
    throw error
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true })
    await handle.close()
    await rm(lock)
  }
}
