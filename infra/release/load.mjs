import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join, resolve, sep } from "node:path"
import { sha256 } from "./release-runtime.mjs"

const [source] = process.argv.slice(2)
if (process.argv.length !== 3)
  throw new Error("Usage: node infra/release/load.mjs <release-directory>")
const directory = resolve(source)
const manifest = JSON.parse(
  await readFile(join(directory, "manifest.json"), "utf8")
)
for (const [name, expected] of Object.entries(manifest.files)) {
  const file = resolve(directory, name)
  if (!file.startsWith(directory + sep))
    throw new Error("RELEASE_MANIFEST_INVALID")
  if ((await sha256(file)) !== expected)
    throw new Error(`RELEASE_CHECKSUM_MISMATCH:${name}`)
}
const services = [
  "api",
  "worker",
  "tenant",
  "platform",
  "migrator",
  "postgres",
  "redis",
  "mailpit",
  "otel-collector",
  "prometheus",
  "tracing",
]
const platform = execFileSync(
  "docker",
  ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"],
  { encoding: "utf8" }
).trim()
if (services.some((service) => manifest.images[service]?.platform !== platform))
  throw new Error("RELEASE_TARGET_PLATFORM_MISMATCH")
for (const service of services) {
  const image = manifest.images[service]
  if (!image || !Object.hasOwn(manifest.files, `${service}.image.tar`))
    throw new Error("RELEASE_MANIFEST_INVALID")
  execFileSync(
    "docker",
    ["load", "--input", join(directory, `${service}.image.tar`)],
    { stdio: "inherit" }
  )
  const actual = JSON.parse(
    execFileSync("docker", ["image", "inspect", image.id], { encoding: "utf8" })
  )[0]
  if (
    actual.Id !== image.id ||
    `${actual.Os}/${actual.Architecture}` !== image.platform
  )
    throw new Error(`RELEASE_IMAGE_MISMATCH:${service}`)
}
console.log(
  `PASS load immutable release ${manifest.version}: hashes and exact image IDs verified`
)
