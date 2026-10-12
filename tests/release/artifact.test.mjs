import { spawnSync } from "node:child_process"
import { mkdtemp, writeFile, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"

test("不可变发行包拒绝未完成安装升级回退恢复验收的记录，不产生发行目录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-artifact-gate-"))
  const file = join(directory, "acceptance.json")
  const destination = join(directory, "release")
  try {
    await writeFile(file, JSON.stringify({ accepted: true, checks: [] }))
    const result = spawnSync(
      process.execPath,
      ["infra/release/package.mjs", "0.1.0", file, destination],
      { encoding: "utf8" }
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("RELEASE_ACCEPTANCE_REQUIRED")
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await rm(directory, { recursive: true })
  }
})

test("离线发行加载在文件哈希不匹配时拒绝执行 Docker load", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-load-gate-"))
  try {
    await writeFile(join(directory, "source.tar"), "changed payload")
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({
        version: "0.1.0",
        images: {},
        files: { "source.tar": "0".repeat(64) },
      })
    )
    const result = spawnSync(
      process.execPath,
      ["infra/release/load.mjs", directory],
      { encoding: "utf8" }
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("RELEASE_CHECKSUM_MISMATCH:source.tar")
  } finally {
    await rm(directory, { recursive: true })
  }
})
