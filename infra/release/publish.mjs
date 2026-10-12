import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { loadEnvFile } from "node:process"
import { setTimeout as delay } from "node:timers/promises"
import { withProjectLock } from "./release-runtime.mjs"

const [project, envFile] = process.argv.slice(2)
if (!project || !envFile || process.argv.length !== 4) {
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

await withProjectLock(project, async () => {
  const configuration = JSON.parse(
    execFileSync("docker", [...args, "config", "--format", "json"], {
      encoding: "utf8",
    })
  )
  // 发布只消费已准备镜像；Compose 重建会改变镜像身份并在迁移前中断在线数据库。
  execFileSync(
    "docker",
    [
      "image",
      "inspect",
      ...new Set(
        Object.values(configuration.services).map((service) => service.image)
      ),
    ],
    { stdio: "ignore" }
  )
  const currentWorker = execFileSync(
    "docker",
    [...args, "ps", "-a", "-q", "worker"],
    { encoding: "utf8" }
  ).trim()
  if (currentWorker) {
    const currentImage = execFileSync(
      "docker",
      ["inspect", "--format", "{{.Image}}", currentWorker],
      { encoding: "utf8" }
    ).trim()
    const catalog = (image) =>
      JSON.parse(
        execFileSync(
          "docker",
          [
            "run",
            "--rm",
            "--entrypoint",
            "node",
            image,
            "-e",
            "import('./dist/registry.js').then(({taskRegistry})=>console.log(JSON.stringify(taskRegistry.map(task=>task.type))))",
          ],
          { encoding: "utf8" }
        )
      )
    const target = new Set(catalog(process.env.RELEASE_WORKER_IMAGE))
    const missing = catalog(currentImage)
      .filter((type) => !target.has(type))
      .sort()
    // Redis 与业务事实继续保留；不能把新任务交给不认识其类型的历史运行时永久拒绝。
    if (missing.length)
      throw new Error(`WORKER_TASK_TYPES_REQUIRED:${missing.join(",")}`)
  }
  compose(
    "up",
    "-d",
    "--no-build",
    "--wait",
    "postgres",
    "redis",
    "mailpit",
    "otel-collector",
    "prometheus",
    "tracing"
  )
  // 只有 one-shot 的真实退出码为 0 才能替换在线应用；失败时保留已有容器。
  compose("run", "--rm", "--no-deps", "migrator")
  // 数据卷归属由无数据库凭据的 one-shot 初始化，在线 API 始终使用 node 身份。
  compose("run", "--rm", "--no-deps", "files-init")
  compose("up", "-d", "--no-deps", "--wait", "api")
  compose("up", "-d", "--no-deps", "worker")
  const deadline = Date.now() + 30_000
  let ready = false
  while (Date.now() < deadline) {
    const status = execFileSync(
      "docker",
      [...args, "ps", "--status", "running", "--services"],
      { encoding: "utf8" }
    )
    if (!status.split("\n").includes("worker")) {
      await delay(500)
      continue
    }
    const container = execFileSync("docker", [...args, "ps", "-q", "worker"], {
      encoding: "utf8",
    }).trim()
    assert.ok(container, "Worker container disappeared during publication")
    const startedAt = execFileSync(
      "docker",
      ["inspect", "--format", "{{.State.StartedAt}}", container],
      { encoding: "utf8" }
    ).trim()
    const logs = execFileSync(
      "docker",
      // 重启时旧容器日志仍存在，ready 必须来自当前这次启动。
      [...args, "logs", "--no-color", "--since", startedAt, "worker"],
      { encoding: "utf8" }
    )
    if (
      status.split("\n").includes("worker") &&
      logs.includes('"event":"worker_ready"')
    ) {
      ready = true
      break
    }
    await delay(500)
  }
  assert.ok(ready, "Worker did not become ready before SPA publication")
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
  console.log(`PASS release ${project}: migrator → API → Worker → SPA → smoke`)
})
