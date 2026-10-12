import { execFileSync } from "node:child_process"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const [version, destination] = process.argv.slice(2)
if (
  process.argv.length !== 4 ||
  !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/.test(version)
)
  throw new Error(
    "Usage: node infra/release/verify.mjs <version> <new-release-directory>"
  )
if (!process.env.RELEASE_ROLLBACK_REF)
  throw new Error("RELEASE_ROLLBACK_REF_REQUIRED")
// ref 必须来自操作者已接受的历史源码；不自动选择父提交或 latest tag 作为安全回退目标。
execFileSync(
  "git",
  ["rev-parse", `${process.env.RELEASE_ROLLBACK_REF}^{commit}`],
  { stdio: "ignore" }
)
const evidence = await mkdtemp(join(tmpdir(), "enterprise-admin-release-gate-"))
const env = {
  ...process.env,
  RELEASE_EVIDENCE_DIR: join(evidence, "acceptance"),
}
execFileSync("pnpm", ["verify"], { env, stdio: "inherit" })
execFileSync("pnpm", ["test:release"], { env, stdio: "inherit" })
execFileSync(
  process.execPath,
  [
    "infra/release/package.mjs",
    version,
    join(env.RELEASE_EVIDENCE_DIR, "result.json"),
    resolve(destination),
  ],
  { env, stdio: "inherit" }
)
console.log(
  `PASS complete local release gate; acceptance evidence: ${evidence}`
)
