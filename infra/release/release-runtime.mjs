import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, readFileSync, openSync, closeSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { parseEnv } from "node:util"

export function releaseRuntime(project, envFile) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
    throw new Error("INVALID_COMPOSE_PROJECT")
  const file = resolve(envFile)
  const env = { ...process.env, ...parseEnv(readFileSync(file, "utf8")) }
  const args = [
    "compose",
    "-p",
    project,
    "--env-file",
    file,
    "-f",
    resolve("compose.release.yaml"),
  ]
  const docker = (command, options = {}) =>
    execFileSync("docker", command, {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    })
  const compose = (...command) => docker([...args, ...command])
  const output = (path, ...command) => {
    const fd = openSync(path, "wx", 0o600)
    try {
      docker([...args, ...command], {
        encoding: null,
        stdio: ["ignore", fd, "pipe"],
      })
    } finally {
      closeSync(fd)
    }
  }
  const input = (path, ...command) => {
    const fd = openSync(path, "r")
    try {
      return docker([...args, ...command], { stdio: [fd, "pipe", "pipe"] })
    } finally {
      closeSync(fd)
    }
  }
  const keyFingerprint = () => {
    if (!env.BETTER_AUTH_SECRET || !env.EMAIL_PAYLOAD_ENCRYPTION_KEY)
      throw new Error("RESTORE_KEYS_REQUIRED")
    return createHash("sha256")
      .update(env.BETTER_AUTH_SECRET)
      .update("\0")
      .update(env.EMAIL_PAYLOAD_ENCRYPTION_KEY)
      .digest("hex")
  }
  return { env, args, docker, compose, output, input, keyFingerprint }
}

export async function sha256(path) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest("hex")
}

export async function withProjectLock(project, operation) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project))
    throw new Error("INVALID_COMPOSE_PROJECT")
  const path = join(tmpdir(), `enterprise-admin-release-lock-${project}`)
  // 同一主机的发布、维护快照与恢复共用排他锁，不能在停写快照中途重新开启业务进程。
  await mkdir(path, { mode: 0o700 })
  try {
    return await operation()
  } finally {
    await rm(path, { recursive: true })
  }
}
