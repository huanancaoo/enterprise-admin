import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const audit = JSON.parse(
  readFileSync(path.join(root, "docs/architecture/dependency-audit.json"))
)
const selected = new Map(
  audit.packages.map((entry) => [entry.name, entry.selected])
)
const manifests = ["package.json"]
for (const directory of ["apps", "packages", "tools"]) {
  for (const entry of readdirSync(path.join(root, directory), {
    withFileTypes: true,
  })) {
    if (
      entry.isDirectory() &&
      existsSync(path.join(root, directory, entry.name, "package.json"))
    )
      manifests.push(`${directory}/${entry.name}/package.json`)
  }
}
let checked = 0
for (const relative of manifests) {
  const manifestPath = path.join(root, relative)
  const manifest = JSON.parse(readFileSync(manifestPath))
  for (const [name, version] of Object.entries({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  })) {
    if (version.startsWith("workspace:")) continue
    assert.equal(
      version,
      selected.get(name),
      `${relative}: ${name} 未使用审计记录中的兼容版本`
    )
    const installed = JSON.parse(
      readFileSync(
        path.join(
          path.dirname(manifestPath),
          "node_modules",
          name,
          "package.json"
        )
      )
    )
    assert.equal(
      installed.version,
      version,
      `${relative}: ${name} 安装版本与声明不一致`
    )
    checked++
  }
}
console.log(
  `PASS dependency audit: ${checked} 个直接依赖声明均与 ${audit.checkedAt} 兼容版本记录及实际安装一致`
)
