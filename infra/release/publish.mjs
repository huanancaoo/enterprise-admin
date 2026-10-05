import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { loadEnvFile } from "node:process"

const [project, envFile] = process.argv.slice(2)
if (!project || !envFile) {
  throw new Error(
    "Usage: node infra/release/publish.mjs <compose-project> <env-file>"
  )
}
loadEnvFile(envFile)
const args = [
  "compose",
  "-p",
  project,
  "--env-file",
  envFile,
  "-f",
  "compose.release.yaml",
]
const compose = (...command) =>
  execFileSync("docker", [...args, ...command], { stdio: "inherit" })

compose("up", "-d", "--wait", "postgres", "redis", "mailpit")
// 只有 one-shot 的真实退出码为 0 才能替换在线应用；失败时保留已有容器。
compose("run", "--rm", "--no-deps", "migrator")
compose("up", "-d", "--no-deps", "--wait", "api")
compose("up", "-d", "--no-deps", "--wait", "tenant", "platform")
for (const origin of [
  process.env.RELEASE_TENANT_ORIGIN,
  process.env.RELEASE_PLATFORM_ORIGIN,
]) {
  const login = await fetch(`${origin}/login`)
  assert.equal(login.status, 200)
  assert.match(login.headers.get("content-type"), /text\/html/)
  const session = await fetch(`${origin}/api/auth/get-session`)
  assert.equal(session.status, 200)
  const missing = await fetch(`${origin}/api/v1/release-missing`)
  assert.equal(missing.status, 404)
  assert.match(missing.headers.get("content-type"), /application\/json/)
}
console.log(`PASS release ${project}: migrator → API → SPA → smoke`)
