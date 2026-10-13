import assert from "node:assert/strict"
import { restoreSnapshot } from "./restore-snapshot.mjs"

const [project, envFile, source] = process.argv.slice(2)
if (process.argv.length !== 5)
  throw new Error(
    "Usage: node infra/release/restore.mjs <new-compose-project> <env-file> <backup-directory>"
  )
await restoreSnapshot(
  project,
  envFile,
  source,
  (manifest, images) => {
    for (const service of ["postgres", "redis"])
      if (images[service] !== manifest.images[service])
        throw new Error(`RESTORE_IMAGE_MISMATCH:${service}`)
  },
  (_runtime, manifest, target) => {
    assert.deepEqual(
      target.database,
      manifest.database,
      "RESTORE_DATABASE_SORTING_MISMATCH"
    )
  },
  (_runtime, manifest, target) => {
    assert.deepEqual(
      target.database,
      manifest.database,
      "RESTORE_DATABASE_SORTING_MISMATCH"
    )
  }
)
console.log(
  `PASS restore ${project}: database, Files and Redis restored into dedicated volumes`
)
