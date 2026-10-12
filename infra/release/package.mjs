import { execFileSync, spawnSync } from "node:child_process"
import { copyFile, mkdir, readFile, writeFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { sha256 } from "./release-runtime.mjs"

const [version, acceptanceFile, destination] = process.argv.slice(2)
if (
  process.argv.length !== 5 ||
  !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)
)
  throw new Error(
    "Usage: node infra/release/package.mjs <version> <acceptance.json> <new-release-directory>"
  )
const accepted = JSON.parse(await readFile(acceptanceFile, "utf8"))
const requiredChecks = [
  "migration-failure-blocks-first-deploy",
  "migration-failure-preserves-running-release",
  "proxy-login-and-runtime-boundaries",
  "rollback-preserves-suspension-and-revocation",
  "files-publish-and-byte-readback",
  "worker-rollback-actual-source",
  "backup-restore-facts-and-files",
  "s3-private-object-recovery",
]
if (
  accepted.accepted !== true ||
  requiredChecks.some((check) => !accepted.checks?.includes(check)) ||
  [
    "postgres",
    "redis",
    "mailpit",
    "otel-collector",
    "prometheus",
    "tracing",
  ].some((service) => !accepted.infrastructureImages?.[service])
)
  throw new Error("RELEASE_ACCEPTANCE_REQUIRED")
if (
  !accepted.sourceArchive ||
  (await sha256(accepted.sourceArchive)) !== accepted.sourceArchiveSha256
)
  throw new Error("RELEASE_SOURCE_CHECKSUM_MISMATCH")
const directory = resolve(destination)
await mkdir(directory, { mode: 0o755 })
const source = join(directory, "source")
await mkdir(source)
execFileSync("tar", ["-xf", accepted.sourceArchive, "-C", source])
const selected = {
  ...accepted.candidateImages,
  migrator: accepted.migrationImage,
}
const configuration = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      join(source, "compose.release.yaml"),
      "config",
      "--format",
      "json",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        POSTGRES_PASSWORD: "package-not-running",
        APP_MIGRATOR_PASSWORD: "package-not-running",
        APP_RUNTIME_PASSWORD: "package-not-running",
        PLATFORM_RUNTIME_PASSWORD: "package-not-running",
        PLATFORM_DEPLOYER_PASSWORD: "package-not-running",
        MIGRATION_DATABASE_URL:
          "postgresql://not-running:not-running@postgres/enterprise_admin",
        BETTER_AUTH_SECRET: "package-not-running",
        EMAIL_PAYLOAD_ENCRYPTION_KEY: "package-not-running",
        GITHUB_CLIENT_ID: "package-not-running",
        GITHUB_CLIENT_SECRET: "package-not-running",
        RELEASE_TENANT_ORIGIN: "http://127.0.0.1:1",
        RELEASE_PLATFORM_ORIGIN: "http://127.0.0.1:2",
        RELEASE_TENANT_PORT: "1",
        RELEASE_PLATFORM_PORT: "2",
        RELEASE_MAIL_PORT: "3",
        ...Object.fromEntries(
          Object.entries(selected).map(([service, image]) => [
            `RELEASE_${service.toUpperCase()}_IMAGE`,
            image,
          ])
        ),
      },
    }
  )
)
for (const service of [
  "postgres",
  "redis",
  "mailpit",
  "otel-collector",
  "prometheus",
  "tracing",
])
  selected[service] = accepted.infrastructureImages[service]
const scanner =
  "aquasec/trivy:0.75.0@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa"
const images = {},
  files = {}
const security = { scanner, passed: true, findings: {} }
await copyFile(accepted.sourceArchive, join(directory, "source.tar"))
await writeFile(
  join(directory, "acceptance.json"),
  JSON.stringify({ ...accepted, sourceArchive: "source.tar" }, null, 2) + "\n"
)
for (const [service, reference] of Object.entries(selected)) {
  const inspected = JSON.parse(
    execFileSync("docker", ["image", "inspect", reference], {
      encoding: "utf8",
    })
  )[0]
  const image = inspected.Id
  images[service] = {
    id: image,
    platform: `${inspected.Os}/${inspected.Architecture}`,
  }
  const archive = `${service}.image.tar`
  execFileSync("docker", ["save", "--output", join(directory, archive), image])
  const scan = (args) =>
    spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--volume",
        `${directory}:/release`,
        "--volume",
        "enterprise-admin-trivy-cache:/root/.cache/trivy",
        scanner,
        "image",
        "--input",
        `/release/${archive}`,
        ...args,
      ],
      { stdio: "inherit" }
    )
  const sbom = scan([
    "--format",
    "cyclonedx",
    "--output",
    `/release/${service}.sbom.cdx.json`,
  ])
  if (sbom.status !== 0) throw new Error(`RELEASE_SBOM_FAILED:${service}`)
  // 扫描不通过时没有最终 manifest；不发布已知 HIGH/CRITICAL 漏洞的镜像。
  const scanned = scan([
    "--scanners",
    "vuln",
    "--severity",
    "HIGH,CRITICAL",
    "--exit-code",
    "1",
    "--format",
    "json",
    "--output",
    `/release/${service}.vulnerabilities.json`,
  ])
  const report = JSON.parse(
    await readFile(join(directory, `${service}.vulnerabilities.json`), "utf8")
  )
  const vulnerabilities = (report.Results ?? []).flatMap(
    (result) => result.Vulnerabilities ?? []
  )
  security.findings[service] = {
    count: vulnerabilities.length,
    fixable: vulnerabilities.filter(
      (vulnerability) => vulnerability.FixedVersion
    ).length,
  }
  if (scanned.status !== 0 && !(scanned.status === 1 && vulnerabilities.length))
    throw new Error(`RELEASE_SCAN_FAILED:${service}`)
  if (vulnerabilities.length) security.passed = false
}
await writeFile(
  join(directory, "security-review.json"),
  JSON.stringify(security, null, 2) + "\n"
)
if (!security.passed)
  throw new Error(
    "RELEASE_VULNERABILITIES_BLOCKED:see security-review.json and per-image reports"
  )
// Docker archive 加载的是实际 image ID；发行包把已验收基础镜像映射到相同 ID 并绑定文件哈希。
// 源码 Compose 使用固定官方 FROM/source/checksum 配方，不允许任意基础镜像替换。
let composeSource = await readFile(join(source, "compose.release.yaml"), "utf8")
for (const service of [
  "postgres",
  "redis",
  "mailpit",
  "otel-collector",
  "prometheus",
  "tracing",
])
  composeSource = composeSource.replace(
    `image: ${configuration.services[service].image}`,
    `image: ${images[service].id}`
  )
// 离线包使用上述已验收 archive，不重新访问依赖源构建基础组件。
composeSource = composeSource.replace(
  /\n    build:\n      context: \.\n      dockerfile: infra\/release\/base\/Dockerfile\.(?:database|telemetry)\n      target: (?:postgres|redis|mailpit|otel-collector|prometheus|tracing)\n      provenance: false/g,
  ""
)
await writeFile(join(source, "compose.release.yaml"), composeSource)
let example = await readFile(join(source, "infra/release/.env.example"), "utf8")
for (const service of ["api", "worker", "tenant", "platform", "migrator"])
  example = example.replace(
    new RegExp(`^RELEASE_${service.toUpperCase()}_IMAGE=.*$`, "m"),
    `RELEASE_${service.toUpperCase()}_IMAGE=${images[service].id}`
  )
await writeFile(join(directory, "release.env.example"), example)
async function hashTree(path, prefix = "") {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = prefix + entry.name
    if (entry.isDirectory()) await hashTree(join(path, entry.name), name + "/")
    else if (entry.isFile()) files[name] = await sha256(join(path, entry.name))
    else throw new Error(`RELEASE_FILE_TYPE_UNSUPPORTED:${name}`)
  }
}
await hashTree(directory)
const manifest = {
  version,
  createdAt: new Date().toISOString(),
  sourceBaseRevision: accepted.sourceBaseRevision,
  sourceArchiveSha256: accepted.sourceArchiveSha256,
  images,
  files,
}
await writeFile(
  join(directory, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { flag: "wx" }
)
console.log(
  `PASS release artifact ${version}: accepted immutable images, security scans and SBOM`
)
