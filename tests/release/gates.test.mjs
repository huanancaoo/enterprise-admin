import { spawnSync } from "node:child_process"
import { mkdtemp, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"

test("发行 gate 在未指定已接受回退源码时拒绝运行，不能生成发行目录", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-ci-gate-"))
  const destination = join(directory, "release")
  try {
    const env = { ...process.env }
    delete env.RELEASE_ROLLBACK_REF
    const result = spawnSync(
      process.execPath,
      ["infra/release/verify.mjs", "0.1.0", destination],
      { env, encoding: "utf8" }
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("RELEASE_ROLLBACK_REF_REQUIRED")
    await expect(access(destination)).rejects.toMatchObject({ code: "ENOENT" })
  } finally {
    await rm(directory, { recursive: true })
  }
})
