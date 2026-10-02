import assert from "node:assert/strict"
import { mkdir, readFile, lstat, symlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { registerFileStorageMatrix } from "./file-storage-matrix.mjs"

export function registerLocalStorageCases(test, fixture) {
  registerFileStorageMatrix(test, fixture)
  test("Local 部署根目录须为完整物理路径预算预留空间", async () => {
    const { root, createFileStorage } = fixture
    const base = join(dirname(root), "long-root")
    const longRoot = join(
      base,
      ...Array.from({ length: 14 }, () => "a".repeat(250))
    )
    await mkdir(longRoot, { recursive: true, mode: 0o700 })
    await assert.rejects(
      () => createFileStorage({ kind: "local", root: longRoot }),
      { code: "STORAGE_CONFIG_INVALID" }
    )
  })
  test("Local 拒绝非私有根目录与根目录符号链接", async () => {
    const { root, createFileStorage } = fixture
    const publicRoot = join(root, "public")
    await mkdir(publicRoot, { mode: 0o755 })
    await assert.rejects(
      () => createFileStorage({ kind: "local", root: publicRoot }),
      { code: "STORAGE_CONFIG_INVALID" }
    )
    const linkedRoot = join(root, "linked-root")
    await symlink(root, linkedRoot)
    await assert.rejects(
      () => createFileStorage({ kind: "local", root: linkedRoot }),
      { code: "STORAGE_UNSAFE_PATH" }
    )
  })
  test("Local 父目录和文件符号链接不能越过私有根目录", async () => {
    const { storage, path, root } = fixture
    const owner = {
      kind: "organization",
      id: "01900000-0000-7000-8000-000000000001",
    }
    const at = (...segments) => ({ owner, area: "files", segments })
    await storage.createDirectory(at())
    const outside = join(dirname(root), "outside")
    await mkdir(outside, { mode: 0o700 })
    await writeFile(join(outside, "secret"), "不得读取或删除")
    await symlink(outside, path(at("linked")))
    await symlink(join(outside, "secret"), path(at("leaf")))
    for (const address of [at("linked", "secret"), at("leaf")]) {
      await assert.rejects(() => storage.open(address), {
        code: "STORAGE_UNSAFE_PATH",
      })
      await assert.rejects(
        () => storage.write(address, [Buffer.from("new")], 3),
        { code: "STORAGE_UNSAFE_PATH" }
      )
      await assert.rejects(
        () =>
          storage.copy(address, at("copy"), {
            bytes: 3,
            sha256: "0".repeat(64),
          }),
        { code: "STORAGE_UNSAFE_PATH" }
      )
      await assert.rejects(() => storage.remove(address), {
        code: "STORAGE_UNSAFE_PATH",
      })
    }
    await assert.rejects(() => storage.createDirectory(at("linked", "sub")), {
      code: "STORAGE_UNSAFE_PATH",
    })
    await assert.rejects(() => storage.removeDirectory(at("linked")), {
      code: "STORAGE_UNSAFE_PATH",
    })
    assert.equal(
      await readFile(join(outside, "secret"), "utf8"),
      "不得读取或删除"
    )
  })
}

// Vitest 负责注册、调度及报告；此进程只在 Linux 内执行选中的同一生产模块用例。
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { createFileStorage, storageKey } =
    await import("../../apps/api/dist/files/storage/storage.js")
  const root = "/app/private-files"
  await mkdir(root, { recursive: true, mode: 0o700 })
  const storage = await createFileStorage({ kind: "local", root })
  const path = (address, directory = false) =>
    join(root, storageKey(address, directory))
  const fixture = {
    storage,
    root,
    path,
    createFileStorage,
    inspectContent: (address) => readFile(path(address)),
    inspectDirectory: async (address) => {
      try {
        return (await lstat(path(address, true))).isDirectory()
      } catch (error) {
        if (error.code === "ENOENT") return false
        throw error
      }
    },
    inspectAbsent: async (address) => {
      try {
        await lstat(path(address))
        return false
      } catch (error) {
        if (error.code === "ENOENT") return true
        throw error
      }
    },
    reopen: () => createFileStorage({ kind: "local", root }),
  }
  const cases = new Map()
  registerLocalStorageCases((name, run) => cases.set(name, run), fixture)
  try {
    await cases.get(process.argv[2])()
  } finally {
    await storage[Symbol.asyncDispose]()
  }
}
