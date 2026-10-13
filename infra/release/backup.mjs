import { mkdir, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { releaseRuntime, sha256, withProjectLock } from "./release-runtime.mjs"
import { readDatabaseMetadata } from "./database-metadata.mjs"

const [project, envFile, destination] = process.argv.slice(2)
if (process.argv.length !== 5)
  throw new Error(
    "Usage: node infra/release/backup.mjs <compose-project> <env-file> <new-backup-directory>"
  )
const runtime = releaseRuntime(project, envFile)
const directory = resolve(destination)

await withProjectLock(project, async () => {
  await mkdir(directory, { mode: 0o700 })
  const images = {}
  for (const service of [
    "api",
    "worker",
    "tenant",
    "platform",
    "postgres",
    "redis",
  ]) {
    const container = runtime.compose("ps", "-q", service).trim()
    if (!container) throw new Error(`BACKUP_SERVICE_REQUIRED:${service}`)
    images[service] = runtime
      .docker(["inspect", "--format", "{{.Image}}", container])
      .trim()
  }
  images.migrator = runtime
    .docker([
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      runtime.env.RELEASE_MIGRATOR_IMAGE,
    ])
    .trim()
  const kind = runtime.env.FILES_STORAGE_BACKEND ?? "local"
  if (!["local", "s3"].includes(kind))
    throw new Error("BACKUP_STORAGE_REQUIRED")
  const keyFingerprint = runtime.keyFingerprint()
  const api = runtime.compose("ps", "-q", "api").trim()
  const runningEnv = Object.fromEntries(
    JSON.parse(
      runtime.docker(["inspect", "--format", "{{json .Config.Env}}", api])
    ).map((value) => {
      const index = value.indexOf("=")
      return [value.slice(0, index), value.slice(index + 1)]
    })
  )
  if (runningEnv.FILES_STORAGE_BACKEND !== kind)
    throw new Error("BACKUP_RUNNING_STORAGE_MISMATCH")
  for (const key of [
    "BETTER_AUTH_SECRET",
    "EMAIL_PAYLOAD_ENCRYPTION_KEY",
    ...(kind === "s3"
      ? [
          "FILES_S3_ENDPOINT",
          "FILES_S3_REGION",
          "FILES_S3_BUCKET",
          "FILES_S3_PREFIX",
          "FILES_S3_ACCESS_KEY_ID",
          "FILES_S3_SECRET_ACCESS_KEY",
        ]
      : []),
  ]) {
    if (runningEnv[key] !== (runtime.env[key] ?? ""))
      throw new Error("BACKUP_RUNNING_CONFIG_MISMATCH")
  }
  // 先关闭入口并排空所有写入者，随后冻结 Redis；PostgreSQL 和对象快照处于同一停写窗口。
  runtime.compose("stop", "-t", "35", "tenant", "platform", "api", "worker")
  const redisVersion = runtime
    .compose("exec", "-T", "redis", "redis-cli", "INFO", "server")
    .match(/^redis_version:([^\r\n]+)/m)?.[1]
  if (redisVersion !== "7.4.5") throw new Error("BACKUP_REDIS_VERSION_REQUIRED")
  runtime.compose("exec", "-T", "redis", "redis-cli", "SAVE")
  runtime.compose("stop", "redis")
  const database = readDatabaseMetadata(runtime)
  runtime.output(
    join(directory, "database.dump"),
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "bootstrap_admin",
    "-d",
    "enterprise_admin",
    "--format=custom"
  )
  runtime.output(
    join(directory, "redis.tar"),
    "run",
    "--rm",
    "-T",
    "--no-deps",
    "--entrypoint",
    "tar",
    "redis",
    "-cpf",
    "-",
    "-C",
    "/data",
    "."
  )
  if (kind === "local") {
    runtime.output(
      join(directory, "files.tar"),
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "--entrypoint",
      "tar",
      "files-init",
      "-cpf",
      "-",
      "-C",
      "/data/files",
      "."
    )
  } else {
    runtime.compose(
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "--user",
      "root",
      "--volume",
      `${directory}:/backup`,
      "--volume",
      `${resolve("infra/release/object-snapshot.mjs")}:/workspace/apps/api/object-snapshot.mjs:ro`,
      "--entrypoint",
      "node",
      "api",
      "object-snapshot.mjs",
      "backup"
    )
  }
  const files = {}
  for (const name of [
    "database.dump",
    "redis.tar",
    ...(kind === "local" ? ["files.tar"] : []),
  ])
    files[name] = await sha256(join(directory, name))
  if (kind === "s3")
    for (const name of await readdir(join(directory, "objects")))
      files[`objects/${name}`] = await sha256(join(directory, "objects", name))
  const manifest = {
    version: 2,
    createdAt: new Date().toISOString(),
    storage: { kind },
    images,
    database,
    redisVersion,
    keyFingerprint,
    files,
  }
  // manifest 最后写入；未取得完整一致快照的目录不能被识别为可恢复备份。
  await writeFile(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600, flag: "wx" }
  )
})
console.log(
  `PASS backup ${project}: applications and Redis remain stopped; resume with publish.mjs after maintenance`
)
