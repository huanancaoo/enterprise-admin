import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { releaseRuntime, sha256, withProjectLock } from "./release-runtime.mjs"
import { readDatabaseMetadata } from "./database-metadata.mjs"

// 恢复与基础发行迁移共用数据链路；调用者必须明确验证各自的基础镜像与排序约束。
export async function restoreSnapshot(
  project,
  envFile,
  source,
  verifyFoundation,
  verifyDatabaseTarget,
  afterDatabaseRestore
) {
  const runtime = releaseRuntime(project, envFile)
  const directory = resolve(source)
  const manifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8")
  )

  await withProjectLock(project, async () => {
    if (
      manifest.version !== 2 ||
      !["local", "s3"].includes(manifest.storage?.kind)
    )
      throw new Error("BACKUP_MANIFEST_INVALID")
    if (runtime.keyFingerprint() !== manifest.keyFingerprint)
      throw new Error("RESTORE_KEYS_MISMATCH")
    if (
      (runtime.env.FILES_STORAGE_BACKEND ?? "local") !== manifest.storage.kind
    )
      throw new Error("RESTORE_STORAGE_MISMATCH")
    const required = [
      "database.dump",
      "redis.tar",
      ...(manifest.storage.kind === "local"
        ? ["files.tar"]
        : ["objects/index.json"]),
    ]
    for (const name of required)
      if (!Object.hasOwn(manifest.files, name))
        throw new Error("BACKUP_MANIFEST_INVALID")
    for (const [name, expected] of Object.entries(manifest.files)) {
      if (
        !/^(database\.dump|redis\.tar|files\.tar|objects\/(index\.json|\d+\.bin))$/.test(
          name
        )
      )
        throw new Error("BACKUP_MANIFEST_INVALID")
      if ((await sha256(join(directory, name))) !== expected)
        throw new Error(`BACKUP_CHECKSUM_MISMATCH:${name}`)
    }
    for (const service of ["api", "worker", "tenant", "platform", "migrator"]) {
      const image = runtime.env[`RELEASE_${service.toUpperCase()}_IMAGE`]
      const actual = runtime
        .docker(["image", "inspect", "--format", "{{.Id}}", image])
        .trim()
      if (actual !== manifest.images[service])
        throw new Error(`RESTORE_IMAGE_MISMATCH:${service}`)
    }
    const configuration = JSON.parse(
      runtime.compose("config", "--format", "json")
    )
    const foundationImages = {}
    for (const service of ["postgres", "redis"])
      foundationImages[service] = runtime
        .docker([
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          configuration.services[service].image,
        ])
        .trim()
    verifyFoundation(manifest, foundationImages)
    const volumes = runtime
      .docker([
        "volume",
        "ls",
        "--quiet",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
      .trim()
    const containers = runtime
      .docker([
        "ps",
        "-aq",
        "--filter",
        `label=com.docker.compose.project=${project}`,
      ])
      .trim()
    if (volumes || containers) throw new Error("RESTORE_REQUIRES_NEW_PROJECT")
    // 空卷 bootstrap 创建角色及新部署密码；dump 恢复对象归属/授权，不恢复数据库角色密码。
    runtime.compose("up", "-d", "--wait", "postgres")
    verifyDatabaseTarget(runtime, manifest, {
      database: readDatabaseMetadata(runtime),
      images: foundationImages,
    })
    runtime.input(
      join(directory, "database.dump"),
      "exec",
      "-T",
      "postgres",
      "pg_restore",
      "-U",
      "bootstrap_admin",
      "-d",
      "enterprise_admin",
      "--clean",
      "--if-exists",
      "--single-transaction",
      "--exit-on-error"
    )
    const database = readDatabaseMetadata(runtime)
    afterDatabaseRestore(runtime, manifest, {
      database,
      images: foundationImages,
    })
    runtime.input(
      join(directory, "redis.tar"),
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "--entrypoint",
      "tar",
      "redis",
      "-xpf",
      "-",
      "-C",
      "/data"
    )
    runtime.compose("run", "--rm", "-T", "--no-deps", "files-init")
    if (manifest.storage.kind === "local") {
      runtime.input(
        join(directory, "files.tar"),
        "run",
        "--rm",
        "-T",
        "--no-deps",
        "--entrypoint",
        "tar",
        "files-init",
        "-xpf",
        "-",
        "-C",
        "/data/files"
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
        `${directory}:/backup:ro`,
        "--volume",
        `${resolve("infra/release/object-snapshot.mjs")}:/workspace/apps/api/object-snapshot.mjs:ro`,
        "--entrypoint",
        "node",
        "api",
        "object-snapshot.mjs",
        "restore"
      )
    }
  })
  // 恢复仍经过正式 migrator/运行时/入口门禁；备份恢复不会执行 down migration。
  execFileSync(
    process.execPath,
    ["infra/release/publish.mjs", project, envFile],
    { env: runtime.env, stdio: "inherit" }
  )
}
