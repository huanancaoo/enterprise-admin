import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, expect, test } from "vitest"
import { parse } from "yaml"

const directories = []
const docker = execFileSync("which", ["docker"], { encoding: "utf8" }).trim()
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true }))
  )
})

async function fixture(compose) {
  const directory = await mkdtemp(join(tmpdir(), "release-compose-yaml-"))
  directories.push(directory)
  const bin = join(directory, "bin")
  await mkdir(bin)
  await writeFile(join(directory, "compose.release.yaml"), compose)
  // 此替身仅记录 CLI 协议，不拉取镜像或运行容器；真实扫描与发行门禁仍由 release 集成测试覆盖。
  await writeFile(
    join(bin, "docker"),
    `#!${process.execPath}
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")
const args = process.argv.slice(2)
if (args[0] === "compose") process.stdout.write(execFileSync(${JSON.stringify(docker)}, args))
else if (args[0] === "image") {
  process.stdout.write(JSON.stringify([{ Id: "sha256:" + args[2], Os: "linux", Architecture: "arm64" }]))
} else if (args[0] === "save") fs.writeFileSync(args[2], "test-image")
else if (args.includes("promtool")) process.stdout.write(JSON.stringify(args))
else if (args[0] === "run") {
  const mount = args[args.indexOf("--volume") + 1].split(":")[0]
  const output = args[args.indexOf("--output") + 1]
  fs.writeFileSync(path.join(mount, path.basename(output)), JSON.stringify({ Results: [] }))
} else process.exit(2)
`,
    { mode: 0o755 }
  )
  return {
    directory,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  }
}

test.each([
  `services:\n  prometheus:\n    restart: unless-stopped\n    image: 'registry.example/prometheus:3' # pinned source\n`,
  `services: {prometheus: {image: "registry.example/prometheus:3"}}\n`,
  `x-prometheus: &prometheus\n  image: registry.example/prometheus:3\nservices:\n  prometheus:\n    <<: *prometheus\n    restart: unless-stopped\n`,
])("告警检查按 YAML 语义选择 Prometheus 镜像：%s", async (compose) => {
  const { directory, env } = await fixture(compose)
  const output = execFileSync(
    process.execPath,
    [resolve("infra/observability/check-alerts.mjs")],
    {
      cwd: directory,
      env,
      encoding: "utf8",
    }
  )
  const args = JSON.parse(output)
  expect(args[args.indexOf("/rules") + 1]).toBe("registry.example/prometheus:3")
})

test("告警检查拒绝有重复字段的 YAML", async () => {
  const { directory, env } = await fixture(
    "services:\n  prometheus:\n    image: first\n    image: second\n"
  )
  const result = spawnSync(
    process.execPath,
    [resolve("infra/observability/check-alerts.mjs")],
    {
      cwd: directory,
      env,
      encoding: "utf8",
    }
  )
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain("already defined")
})

test("发行打包只固定已验收服务镜像，保留共享锚点的其他服务语义", async () => {
  const services = [
    "postgres",
    "redis",
    "mailpit",
    "otel-collector",
    "prometheus",
    "tracing",
  ]
  const compose = `x-base: &base\n  image: &image 'registry.example/shared:1'\n  restart: unless-stopped\nservices:\n  postgres: *base\n${services
    .slice(1)
    .map((service) => `  ${service}:\n    <<: *base\n    image: *image`)
    .join(
      "\n"
    )}\n  api:\n    image: \${RELEASE_API_IMAGE:?required}\n  unselected: *base\n`
  const { directory, env } = await fixture(compose)
  await mkdir(join(directory, "infra/release"), { recursive: true })
  await writeFile(
    join(directory, "infra/release/.env.example"),
    "RELEASE_API_IMAGE=source:1\n"
  )
  const archive = join(directory, "source.tar")
  execFileSync("tar", ["-cf", archive, "compose.release.yaml", "infra"], {
    cwd: directory,
  })
  const acceptance = join(directory, "acceptance.json")
  await writeFile(
    acceptance,
    JSON.stringify({
      accepted: true,
      checks: [
        "migration-failure-blocks-first-deploy",
        "migration-failure-preserves-running-release",
        "proxy-login-and-runtime-boundaries",
        "rollback-preserves-suspension-and-revocation",
        "files-publish-and-byte-readback",
        "worker-rollback-actual-source",
        "business-task-worker-rollback-and-recovery",
        "credential-revocation-after-recovery",
        "backup-restore-facts-and-files",
        "s3-private-object-recovery",
        "bookworm-alpine-logical-migration-and-sort",
      ],
      infrastructureImages: Object.fromEntries(
        services.map((service) => [service, service])
      ),
      candidateImages: {
        api: "api",
        worker: "worker",
        tenant: "tenant",
        platform: "platform",
      },
      migrationImage: "migrator",
      sourceArchive: archive,
      sourceArchiveSha256: createHash("sha256")
        .update(await readFile(archive))
        .digest("hex"),
    })
  )
  const destination = join(directory, "release")
  execFileSync(
    process.execPath,
    ["infra/release/package.mjs", "0.1.0", acceptance, destination],
    { env }
  )
  const output = parse(
    await readFile(join(destination, "source/compose.release.yaml"), "utf8"),
    { merge: true }
  )
  for (const service of services) {
    expect(output.services[service]).toEqual({
      image: `sha256:${service}`,
      restart: "unless-stopped",
    })
  }
  expect(output.services.unselected).toEqual({
    image: "registry.example/shared:1",
    restart: "unless-stopped",
  })
  expect(output["x-base"]).toEqual(output.services.unselected)
  expect(output.services.api.image).toBe("${RELEASE_API_IMAGE:?required}")
  expect(await readFile(join(destination, "release.env.example"), "utf8")).toBe(
    "RELEASE_API_IMAGE=sha256:api\n"
  )
  const manifest = JSON.parse(
    await readFile(join(destination, "manifest.json"), "utf8")
  )
  expect(manifest.files["source/compose.release.yaml"]).toBe(
    createHash("sha256")
      .update(await readFile(join(destination, "source/compose.release.yaml")))
      .digest("hex")
  )
})
