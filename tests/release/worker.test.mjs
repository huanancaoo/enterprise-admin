import { spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { createServer } from "node:net"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { startTestApplication } from "../setup/test-runtime.mjs"

const name = "enterprise-worker-smoke-" + randomUUID()
const image = name + ":local"
let environment, directory, container
async function docker(args, timeout = 900_000) {
  return command("docker", args, timeout)
}
async function command(program, args, timeout = 900_000) {
  const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (bytes) => {
    output += bytes
  })
  child.stderr.on("data", (bytes) => {
    output += bytes
  })
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout)
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code) => resolve({ code, output }))
    })
  } finally {
    clearTimeout(timer)
  }
}
async function port() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const value = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return value
}
async function checked(args) {
  const result = await docker(args)
  if (result.code !== 0)
    throw new Error("Worker Docker smoke: " + result.output.slice(-4000))
  return result.output.trim()
}
async function envFile(connection, suffix) {
  const file = join(directory, suffix + ".env")
  await writeFile(
    file,
    [
      `DATABASE_URL=${connection}`,
      `REDIS_URL=${environment.containerConfig.redisURL}`,
      "WORKER_QUEUE_PREFIX=jobs-smoke",
      "WORKER_SHUTDOWN_MS=30000",
    ].join("\n") + "\n",
    { mode: 0o600 }
  )
  return file
}

describe.sequential("核心 Worker 生产镜像", () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "worker-image-smoke-"))
    const bases = await command(process.execPath, [
      "infra/release/build-base-images.mjs",
    ])
    expect(bases.code, bases.output.slice(-4000)).toBe(0)
    const build = await docker([
      "build",
      "--target",
      "worker",
      "-f",
      "infra/release/Dockerfile",
      "-t",
      image,
      ".",
    ])
    await writeFile(join(directory, "build.log"), build.output)
    expect(build.code, build.output.slice(-4000)).toBe(0)
    environment = await startTestApplication()
  })
  afterAll(async () => {
    if (container) await docker(["rm", "-f", container])
    await environment?.close()
    await docker(["image", "rm", image])
    // build.log 留在测试专属临时目录供审阅；只删除临时凭据文件。
    if (directory)
      for (const suffix of ["runtime", "privileged"])
        await rm(join(directory, suffix + ".env"), { force: true })
  })
  test("非 root 镜像以真实运行身份连接数据库及 Redis，默认就绪并可正常停止", async () => {
    const file = await envFile(
      environment.containerConfig.databaseURL,
      "runtime"
    )
    container = await checked([
      "run",
      "-d",
      "--name",
      name,
      "--init",
      "--network",
      environment.containerNetwork.getName(),
      "--env-file",
      file,
      image,
    ])
    await expect
      .poll(async () => (await docker(["logs", container])).output, {
        timeout: 20_000,
      })
      .toContain('"event":"worker_ready"')
    expect(await checked(["exec", container, "id", "-u"])).toBe("1000")
    expect(
      await checked(["inspect", "--format", "{{.State.Running}}", container])
    ).toBe("true")
    await checked(["stop", "--timeout", "35", container])
    expect(
      await checked(["inspect", "--format", "{{.State.ExitCode}}", container])
    ).toBe("0")
  })
  test("部署凭据不能用作 Worker 运行身份，错误日志不包含连接秘密", async () => {
    const connection = new URL(environment.observer.options.connectionString)
    connection.hostname = "database"
    connection.port = "5432"
    const file = await envFile(connection.toString(), "privileged")
    const result = await docker(
      [
        "run",
        "--rm",
        "--network",
        environment.containerNetwork.getName(),
        "--env-file",
        file,
        image,
      ],
      20_000
    )
    expect(result.code).toBe(1)
    expect(result.output).toContain("WORKER_RUNTIME_ROLE_REQUIRED")
    expect(result.output).not.toContain(connection.password)
  })

  test("默认 Compose 发布固定包含 Worker；迁移失败与 Worker 未就绪都阻止后续部署", async () => {
    const project = name + "-release",
      file = join(directory, "release.env")
    const tags = []
    const images = {
      worker: await checked(["image", "inspect", "--format", "{{.Id}}", image]),
    }
    let configured = false
    const compose = (...args) =>
      docker([
        "compose",
        "-p",
        project,
        "--env-file",
        file,
        "-f",
        "compose.release.yaml",
        ...args,
      ])
    try {
      for (const target of ["api", "tenant", "platform", "migrator"]) {
        const tag = `${name}:${target}`
        tags.push(tag)
        await checked([
          "build",
          "--target",
          target,
          "-f",
          "infra/release/Dockerfile",
          "-t",
          tag,
          ".",
        ])
        images[target] = await checked([
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          tag,
        ])
      }
      const failDir = join(directory, "fail")
      await import("node:fs/promises").then(({ mkdir }) => mkdir(failDir))
      const failure = name + ":migration-failure"
      tags.push(failure)
      await writeFile(
        join(failDir, "Dockerfile"),
        `FROM ${name}:migrator\nCOPY fail.mjs ./fail.mjs\nCMD ["node", "fail.mjs"]\n`
      )
      await writeFile(
        join(failDir, "fail.mjs"),
        `import { Pool } from 'pg';const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});try{await pool.query('SELECT public.worker_migration_gate_fixture()')}catch(error){console.error('worker migration gate '+error.code);process.exitCode=1}finally{await pool.end()}\n`
      )
      await checked(["build", "-t", failure, failDir])
      const env = {
        POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
        APP_MIGRATOR_PASSWORD: randomBytes(24).toString("hex"),
        APP_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
        PLATFORM_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
        PLATFORM_DEPLOYER_PASSWORD: randomBytes(24).toString("hex"),
        BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
        EMAIL_PAYLOAD_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        GITHUB_CLIENT_ID: "worker-release-fixture",
        GITHUB_CLIENT_SECRET: randomBytes(32).toString("hex"),
        RELEASE_TENANT_PORT: await port(),
        RELEASE_PLATFORM_PORT: await port(),
        RELEASE_MAIL_PORT: await port(),
        RELEASE_OTLP_PORT: await port(),
        RELEASE_PROMETHEUS_PORT: await port(),
        RELEASE_TRACING_PORT: await port(),
        RELEASE_API_IMAGE: images.api,
        RELEASE_WORKER_IMAGE: images.worker,
        RELEASE_TENANT_IMAGE: images.tenant,
        RELEASE_PLATFORM_IMAGE: images.platform,
        RELEASE_MIGRATOR_IMAGE: failure,
      }
      env.MIGRATION_DATABASE_URL = `postgresql://app_migrator:${env.APP_MIGRATOR_PASSWORD}@postgres:5432/enterprise_admin`
      env.RELEASE_TENANT_ORIGIN = `http://127.0.0.1:${env.RELEASE_TENANT_PORT}`
      env.RELEASE_PLATFORM_ORIGIN = `http://127.0.0.1:${env.RELEASE_PLATFORM_PORT}`
      const save = () =>
        writeFile(
          file,
          Object.entries(env)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n") + "\n",
          { mode: 0o600 }
        )
      const publish = () =>
        command(process.execPath, ["infra/release/publish.mjs", project, file])
      await save()
      configured = true
      const rejected = await publish()
      expect(rejected.code).not.toBe(0)
      expect(rejected.output).toContain("worker migration gate 42883")
      expect((await compose("ps", "--services")).output).not.toMatch(
        /\b(api|worker|tenant|platform)\b/
      )
      env.RELEASE_MIGRATOR_IMAGE = images.migrator
      await save()
      const published = await publish()
      expect(published.code, published.output.slice(-2000)).toBe(0)
      expect(published.output).toContain(
        "migrator → API → Worker → SPA → smoke"
      )
      expect(
        (await compose("ps", "--status", "running", "--services")).output
      ).toContain("worker")
      expect(
        (
          await compose(
            "exec",
            "-T",
            "redis",
            "redis-cli",
            "CONFIG",
            "GET",
            "appendonly"
          )
        ).output
      ).toContain("yes")
      expect(
        (
          await compose(
            "exec",
            "-T",
            "redis",
            "redis-cli",
            "CONFIG",
            "GET",
            "maxmemory-policy"
          )
        ).output
      ).toContain("noeviction")
      const old = (
        await compose("ps", "-q", "tenant", "platform")
      ).output.trim()
      const unready = name + ":unready"
      tags.push(unready)
      await writeFile(
        join(failDir, "Dockerfile"),
        `FROM ${image}\nCMD ["node", "-e", "setInterval(()=>{},1000)"]\n`
      )
      await checked(["build", "-t", unready, failDir])
      env.RELEASE_WORKER_IMAGE = unready
      await save()
      const stopped = await publish()
      expect(stopped.code).not.toBe(0)
      expect(stopped.output).toContain("Worker did not become ready")
      expect(
        (await compose("ps", "-q", "tenant", "platform")).output.trim()
      ).toBe(old)
      env.RELEASE_WORKER_IMAGE = images.worker
      await save()
      expect((await publish()).code).toBe(0)
      const registered = name + ":additional-task"
      tags.push(registered)
      await writeFile(
        join(failDir, "registry.mjs"),
        "import { taskRegistry as previous } from './original-registry.js';\nexport const taskRegistry = [...previous, {type: 'release-catalog-marker', permissions: {project: ['read']}, parseInput(input) {return input}, async authorizeResource() {}, async findCommitted() {}, async execute() {return {count: 0}}}];\n"
      )
      await writeFile(
        join(failDir, "Dockerfile"),
        `FROM ${image}\nUSER root\nRUN mv dist/registry.js dist/original-registry.js\nCOPY registry.mjs dist/registry.js\nUSER node\n`
      )
      await checked(["build", "-t", registered, failDir])
      env.RELEASE_WORKER_IMAGE = registered
      await save()
      expect((await publish()).code).toBe(0)
      env.RELEASE_WORKER_IMAGE = images.worker
      await save()
      const missingTask = await publish()
      expect(missingTask.code).not.toBe(0)
      expect(missingTask.output).toContain(
        "WORKER_TASK_TYPES_REQUIRED:release-catalog-marker"
      )
      const workerImage = await checked([
        "inspect",
        "--format",
        "{{.Image}}",
        (await compose("ps", "-q", "worker")).output.trim(),
      ])
      expect(workerImage).toBe(
        await checked(["image", "inspect", "--format", "{{.Id}}", registered])
      )
    } finally {
      if (configured) await compose("down", "--volumes")
      for (const tag of tags) await docker(["image", "rm", tag])
      await rm(file, { force: true })
    }
  }, 900_000)
})
