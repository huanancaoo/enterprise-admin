import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseEnv } from "node:util"
import { databaseQuery } from "./database-metadata.mjs"
import { restoreSnapshot } from "./restore-snapshot.mjs"

const [project, envFile, source] = process.argv.slice(2)
if (process.argv.length !== 5)
  throw new Error(
    "Usage: node infra/release/migrate-foundation.mjs <new-compose-project> <env-file> <bookworm-backup-directory>"
  )
let report
await restoreSnapshot(
  project,
  envFile,
  source,
  (manifest, images) => {
    if (
      manifest.database.os.id !== "debian" ||
      manifest.database.os.versionId !== "12" ||
      manifest.database.serverVersionNum !== 180006 ||
      manifest.redisVersion !== "7.4.5"
    )
      throw new Error("FOUNDATION_SOURCE_REQUIRES_POSTGRES_18_6_BOOKWORM")
    if (
      ["postgres", "redis"].some(
        (service) => images[service] === manifest.images[service]
      )
    )
      throw new Error("FOUNDATION_TARGET_IMAGES_REQUIRED")
  },
  (runtime, manifest, target) => {
    const redisVersion = runtime.docker([
      "run",
      "--rm",
      "--entrypoint",
      "redis-server",
      target.images.redis,
      "--version",
    ])
    const redisOs = parseEnv(
      runtime.docker([
        "run",
        "--rm",
        "--entrypoint",
        "cat",
        target.images.redis,
        "/etc/os-release",
      ])
    )
    if (!/\bv=7\.4\.5\b/.test(redisVersion) || redisOs.ID !== "alpine")
      throw new Error("FOUNDATION_TARGET_REQUIRES_REDIS_7_4_5_ALPINE")
    if (
      target.database.os.id !== "alpine" ||
      target.database.serverVersionNum !== 180006 ||
      target.database.encoding !== "UTF8"
    )
      throw new Error("FOUNDATION_TARGET_REQUIRES_POSTGRES_18_6_ALPINE")
    assert.deepEqual(
      target.database.sorting,
      {
        provider: "c",
        collate: "en_US.utf8",
        ctype: "en_US.utf8",
        locale: null,
        version: null,
        actualVersion: null,
      },
      "FOUNDATION_TARGET_SORTING_MISMATCH"
    )
    assert.deepEqual(
      target.database.sortingProbe,
      ["Z", "a", "a-a", "a_a", "Å", "ä", "北京"],
      "FOUNDATION_TARGET_SORT_ORDER_MISMATCH"
    )
  },
  (runtime, manifest, target) => {
    // 系统排序库改变时不复用旧卷或刷新版本号；逻辑恢复后的索引必须在目标规则下完整重建。
    databaseQuery(runtime, "REINDEX DATABASE enterprise_admin")
    const invalidIndexes = Number(
      databaseQuery(
        runtime,
        "SELECT count(*) FROM pg_index WHERE NOT indisvalid"
      )
    )
    if (invalidIndexes !== 0) throw new Error("FOUNDATION_INVALID_INDEXES")
    report = {
      source: { database: manifest.database, images: manifest.images },
      target,
      invalidIndexes,
    }
  }
)
await writeFile(
  join(resolve(source), "foundation-migration.json"),
  JSON.stringify(
    { ...report, completedAt: new Date().toISOString() },
    null,
    2
  ) + "\n",
  { mode: 0o600, flag: "wx" }
)
console.log(
  `PASS foundation migration ${project}: Bookworm logical snapshot → Alpine dedicated volumes → rebuilt indexes → release smoke`
)
