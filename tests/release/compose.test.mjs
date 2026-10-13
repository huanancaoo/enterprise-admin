import { spawn, execFileSync } from "node:child_process"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, expect as expectUI } from "playwright/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { platformTotp } from "../setup/platform-operator.mjs"

const rollbackRef = process.env.RELEASE_ROLLBACK_REF
const project = `enterprise-release-${randomBytes(6).toString("hex")}`
const root = process.cwd()
const require = createRequire(
  new URL("../../apps/api/package.json", import.meta.url)
)
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
let executionRoot = root
let directory, env, oldImages, images, failedImage, migrationImage
let sourceArchive, sourceArchiveSha256, sourceBaseRevision
let releaseRecordCreated = false,
  localRecoveryAccepted = false,
  s3RecoveryAccepted = false,
  foundationMigrationAccepted = false
let owner, member, operator, suspended, active, membership
let retainedFile
const retainedBytes = Buffer.from("发行包必须保留文件的真实字节\n")

let retainedBusinessTask, revokedReleaseCredential
async function writeEnvironment(file, values) {
  await writeFile(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
}
const businessRequest = (suffix, options = {}) =>
  fetch(
    `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${active.id}${suffix}`,
    {
      ...options,
      headers: {
        cookie: owner.cookie,
        origin: env.RELEASE_TENANT_ORIGIN,
        ...options.headers,
      },
    }
  )
async function completedBusinessTask(kind, body) {
  const response = await businessRequest(`/projects/${kind}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(202)
  const task = await response.json()
  await expect
    .poll(
      async () => {
        const read = await businessRequest(`/tasks/${task.id}`)
        expect(read.status).toBe(200)
        return (await read.json()).status
      },
      { timeout: 20000 }
    )
    .toBe("completed")
  return task
}
async function recordBusinessRecoveryFacts() {
  const task = await completedBusinessTask("exports", {
    format: "csv",
    filter: {},
  })
  const result = await businessRequest(`/tasks/${task.id}/result`)
  expect(result.status).toBe(200)
  retainedBusinessTask = {
    id: task.id,
    sha256: createHash("sha256")
      .update(Buffer.from(await result.arrayBuffer()))
      .digest("hex"),
  }
  const created = await businessRequest("/access-credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "release-revocation",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      permissions: { project: ["read"] },
    }),
  })
  expect(created.status).toBe(201)
  revokedReleaseCredential = await created.json()
  expect(
    (
      await fetch(
        `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${active.id}/projects`,
        { headers: { "x-api-key": revokedReleaseCredential.key } }
      )
    ).status
  ).toBe(200)
  expect(
    (
      await businessRequest(
        `/access-credentials/${revokedReleaseCredential.id}`,
        { method: "DELETE" }
      )
    ).status
  ).toBe(204)
}
async function assertBusinessRecoveryFacts() {
  const result = await businessRequest(
    `/tasks/${retainedBusinessTask.id}/result`
  )
  expect(result.status).toBe(200)
  expect(
    createHash("sha256")
      .update(Buffer.from(await result.arrayBuffer()))
      .digest("hex")
  ).toBe(retainedBusinessTask.sha256)
  expect(
    (
      await fetch(
        `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${active.id}/projects`,
        { headers: { "x-api-key": revokedReleaseCredential.key } }
      )
    ).status
  ).toBe(401)
}
async function assertBusinessWorkerAfterRollback() {
  const name = `rollback-worker-${randomUUID()}`
  const task = await completedBusinessTask("imports", {
    format: "csv",
    contentBase64: Buffer.from(
      `name,description,contentLocale\n${name},after-real-worker-rollback,zh-CN\n`
    ).toString("base64"),
  })
  const read = await businessRequest(`/tasks/${task.id}`)
  expect((await read.json()).result).toEqual({ count: 1, issues: [] })
  const projects = await businessRequest(`/projects?name=${name}`)
  expect((await projects.json()).total).toBe(1)
}

async function fileRequest(suffix, options = {}) {
  return fetch(
    `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${active.id}/files${suffix}`,
    {
      ...options,
      headers: {
        cookie: owner.cookie,
        origin: env.RELEASE_TENANT_ORIGIN,
        ...options.headers,
      },
    }
  )
}

async function assertRetainedFile() {
  const response = await fileRequest(
    `/entries/${retainedFile.id}/versions/${retainedFile.currentVersion.id}/content`
  )
  expect(response.status).toBe(200)
  expect(Buffer.from(await response.arrayBuffer())).toEqual(retainedBytes)
}

async function command(file, args, options = {}) {
  const child = spawn(file, args, {
    cwd: executionRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  })
  let stdout = "",
    stderr = ""
  child.stdout.on("data", (chunk) => {
    stdout += chunk
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk
  })
  return new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("close", (status) => resolve({ status, stdout, stderr }))
  })
}

async function checked(file, args, options) {
  const result = await command(file, args, options)
  if (result.status !== 0) {
    // Compose 的参数可能含临时部署凭据；失败只展示进程输出，不回显完整命令。
    throw new Error(
      `${file} failed (${result.status}): ${result.stderr.slice(-6000)} ${result.stdout.slice(-2000)}`
    )
  }
  return result.stdout.trim()
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return String(port)
}

const composeArgs = () => [
  "compose",
  "-p",
  project,
  "--env-file",
  join(directory, "release.env"),
  "-f",
  "compose.release.yaml",
]
const compose = (...args) => checked("docker", [...composeArgs(), ...args])
const query = (sql) =>
  compose(
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "bootstrap_admin",
    "-d",
    "enterprise_admin",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    sql
  )

async function selectImages(selected, migrator = migrationImage) {
  Object.assign(env, {
    RELEASE_API_IMAGE: selected.api,
    RELEASE_TENANT_IMAGE: selected.tenant,
    RELEASE_PLATFORM_IMAGE: selected.platform,
    RELEASE_MIGRATOR_IMAGE: migrator,
    RELEASE_WORKER_IMAGE: selected.worker,
  })
  await writeFile(
    join(directory, "release.env"),
    Object.entries(env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 }
  )
}

const publish = () =>
  command(process.execPath, [
    "infra/release/publish.mjs",
    project,
    join(directory, "release.env"),
  ])
async function publishSuccessfully() {
  const result = await publish()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain("migrator → API → Worker → SPA")
}

async function build(context, dockerfile, target, tag, revision) {
  const result = await command("docker", [
    "build",
    "-f",
    dockerfile,
    ...(target ? ["--target", target] : []),
    "--build-arg",
    `RELEASE_REVISION=${revision}`,
    "-t",
    tag,
    context,
  ])
  await writeFile(
    join(directory, `${tag.split(":").at(-1)}.log`),
    result.stdout + result.stderr
  )
  expect(result.status, result.stderr.slice(-4000)).toBe(0)
  return checked("docker", ["image", "inspect", "--format", "{{.Id}}", tag])
}

async function applicationImages(context, revision, suffix) {
  const result = {}
  for (const target of ["api", "tenant", "platform", "worker"]) {
    result[target] = await build(
      context,
      join(context, "infra/release/Dockerfile"),
      target,
      `${project}:${suffix}-${target}`,
      revision
    )
  }
  return result
}

async function auth(path, body, actor, headers = {}) {
  const response = await fetch(
    `${env.RELEASE_TENANT_ORIGIN}/api/auth/${path}`,
    {
      method: "POST",
      headers: {
        origin: env.RELEASE_TENANT_ORIGIN,
        "accept-language": "zh-CN",
        "content-type": "application/json",
        ...(actor ? { cookie: actor.cookie } : {}),
        ...headers,
      },
      body: JSON.stringify(body),
    }
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return response
}

async function account(name) {
  const email = `${randomUUID()}@example.test`,
    password = randomBytes(24).toString("hex")
  const signup = await auth("sign-up/email", { name, email, password })
  const { user } = await signup.json()
  const mail = await waitForMail(
    `http://127.0.0.1:${env.RELEASE_MAIL_PORT}`,
    email,
    "验证你的邮箱"
  )
  const verified = await fetch(firstHttpUrl(mail.HTML), { redirect: "manual" })
  expect([200, 302]).toContain(verified.status)
  const signin = await auth("sign-in/email", { email, password })
  const cookie = signin.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  const session = await fetch(
    `${env.RELEASE_TENANT_ORIGIN}/api/auth/get-session`,
    { headers: { cookie } }
  )
  expect((await session.json()).user.emailVerified).toBe(true)
  return { user, email, password, cookie }
}

async function assignment(action) {
  return compose(
    "run",
    "--rm",
    "--no-deps",
    "-e",
    `PLATFORM_ASSIGNMENT_DATABASE_URL=postgresql://platform_deployer:${env.PLATFORM_DEPLOYER_PASSWORD}@postgres:5432/enterprise_admin`,
    "api",
    "node",
    "dist/console.js",
    "platform",
    "assignment",
    action,
    "--user-id",
    operator.user.id,
    "--role",
    "platform_admin",
    "--reason",
    "local release acceptance"
  )
}

const projects = (organization, actor) =>
  fetch(
    `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${organization.id}/projects`,
    { headers: { cookie: actor.cookie } }
  )
const platformAccess = () =>
  fetch(`${env.RELEASE_PLATFORM_ORIGIN}/api/v1/me/platform`, {
    headers: { cookie: operator.cookie },
  })
async function transition(action, version) {
  const response = await fetch(
    `${env.RELEASE_PLATFORM_ORIGIN}/api/v1/platform/organizations/${suspended.id}/${action}`,
    {
      method: "POST",
      headers: {
        cookie: operator.cookie,
        origin: env.RELEASE_PLATFORM_ORIGIN,
        "content-type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        reason: "local release acceptance",
        expectedVersion: version,
      }),
    }
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}

async function imageIDs() {
  const result = {}
  for (const service of ["api", "tenant", "platform", "worker"]) {
    const id = await compose("ps", "-q", service)
    result[service] = id
      ? await checked("docker", ["inspect", "--format", "{{.Image}}", id])
      : null
  }
  return result
}

describe.sequential("local Compose release and S8 rollback", () => {
  beforeAll(async () => {
    if (!rollbackRef)
      throw new Error(
        "Set RELEASE_ROLLBACK_REF to the exact previously accepted commit"
      )
    if (process.env.RELEASE_EVIDENCE_DIR) {
      directory = process.env.RELEASE_EVIDENCE_DIR
      await mkdir(directory, { mode: 0o700 })
    } else {
      directory = await mkdtemp(join(tmpdir(), "enterprise-admin-release-"))
    }
    console.log(`Release evidence: ${directory}`)
    const tenantPort = await reservePort(),
      platformPort = await reservePort(),
      mailPort = await reservePort()
    env = {
      POSTGRES_PASSWORD: randomBytes(24).toString("hex"),
      APP_MIGRATOR_PASSWORD: randomBytes(24).toString("hex"),
      APP_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
      PLATFORM_RUNTIME_PASSWORD: randomBytes(24).toString("hex"),
      PLATFORM_DEPLOYER_PASSWORD: randomBytes(24).toString("hex"),
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      EMAIL_PAYLOAD_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      GITHUB_CLIENT_ID: "local-release-fixture",
      GITHUB_CLIENT_SECRET: randomBytes(32).toString("hex"),
      RELEASE_TENANT_PORT: tenantPort,
      RELEASE_PLATFORM_PORT: platformPort,
      RELEASE_MAIL_PORT: mailPort,
      RELEASE_OTLP_PORT: await reservePort(),
      RELEASE_PROMETHEUS_PORT: await reservePort(),
      RELEASE_TRACING_PORT: await reservePort(),
      RELEASE_TENANT_ORIGIN: `http://127.0.0.1:${tenantPort}`,
      RELEASE_PLATFORM_ORIGIN: `http://127.0.0.1:${platformPort}`,
    }
    env.MIGRATION_DATABASE_URL = `postgresql://app_migrator:${env.APP_MIGRATOR_PASSWORD}@postgres:5432/enterprise_admin`
    const previous = join(directory, "previous")
    await mkdir(previous)
    const revision = await checked("git", [
      "rev-parse",
      `${rollbackRef}^{commit}`,
    ])
    await checked("git", [
      "archive",
      "--format=tar",
      `--output=${join(directory, "previous.tar")}`,
      revision,
    ])
    await checked("tar", [
      "-xf",
      join(directory, "previous.tar"),
      "-C",
      previous,
    ])
    // 当前工作区先取得不含 ignored 凭据/依赖的源码快照，冷构建期间不会混入后续开发改动。
    const candidate = join(directory, "candidate")
    await mkdir(candidate)
    const paths = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root }
    )
    execFileSync(
      "tar",
      ["-cf", join(directory, "candidate.tar"), "--null", "-T", "-"],
      { cwd: root, input: paths }
    )
    execFileSync("tar", [
      "-xf",
      join(directory, "candidate.tar"),
      "-C",
      candidate,
    ])
    sourceArchive = join(directory, "candidate.tar")
    sourceArchiveSha256 = createHash("sha256")
      .update(await readFile(sourceArchive))
      .digest("hex")
    sourceBaseRevision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim()
    executionRoot = candidate
    // 历史应用使用该已验收提交自己的镜像配方，不能用新依赖伪造历史构建。
    images = await applicationImages(candidate, "local-candidate", "candidate")
    oldImages = await applicationImages(previous, revision, "previous")
    expect(oldImages.worker).not.toBe(images.worker)
    const migratorTag = `${project}:migrator`
    migrationImage = await build(
      candidate,
      join(candidate, "infra/release/Dockerfile"),
      "migrator",
      migratorTag,
      "local-candidate"
    )
    const failure = join(directory, "failure")
    await mkdir(join(failure, "meta"), { recursive: true })
    const journal = JSON.parse(
      await readFile(
        join(candidate, "packages/database/migrations/meta/_journal.json"),
        "utf8"
      )
    )
    const last = journal.entries.at(-1),
      tag = `${String(journal.entries.length).padStart(4, "0")}_release_gate_failure`
    journal.entries.push({
      ...last,
      idx: journal.entries.length,
      when: last.when + 1,
      tag,
    })
    await writeFile(
      join(failure, "meta/_journal.json"),
      JSON.stringify(journal)
    )
    await writeFile(
      join(failure, `${tag}.sql`),
      "SELECT public.release_gate_failure();\n"
    )
    await writeFile(
      join(failure, "Dockerfile"),
      `FROM ${migratorTag}\nCOPY meta/_journal.json /workspace/packages/database/migrations/meta/_journal.json\nCOPY ${tag}.sql /workspace/packages/database/migrations/${tag}.sql\n`
    )
    failedImage = await build(
      failure,
      join(failure, "Dockerfile"),
      null,
      `${project}:failed-migrator`,
      "failure-fixture"
    )
    await selectImages(oldImages, failedImage)
    // 冷启动基础组件构建属于准备阶段；业务用例的超时只衡量真实发布和恢复。
    await checked(process.execPath, ["infra/release/build-base-images.mjs"])
    await writeFile(
      join(directory, "images.json"),
      JSON.stringify(
        {
          project,
          rollbackRevision: revision,
          images,
          oldImages,
          migrationImage,
        },
        null,
        2
      )
    )
  })
  afterAll(async () => {
    let infrastructureImages
    if (
      releaseRecordCreated &&
      localRecoveryAccepted &&
      s3RecoveryAccepted &&
      foundationMigrationAccepted
    ) {
      infrastructureImages = {}
      for (const service of [
        "postgres",
        "redis",
        "mailpit",
        "otel-collector",
        "prometheus",
        "tracing",
      ]) {
        const container = await compose("ps", "--all", "-q", service)
        infrastructureImages[service] = await checked("docker", [
          "inspect",
          "--format",
          "{{.Image}}",
          container,
        ])
      }
    }
    if (env?.RELEASE_API_IMAGE) {
      try {
        await writeFile(
          join(directory, "compose.log"),
          await compose("logs", "--no-color")
        )
      } finally {
        await compose("down", "--volumes")
      }
    }
    // 保留不含秘密的镜像/日志证据；删除本轮随机凭据和源码快照。
    if (directory) {
      await rm(join(directory, "release.env"), { force: true })
      await rm(join(directory, "previous.tar"), { force: true })
      await rm(join(directory, "previous"), { recursive: true, force: true })
      await rm(join(directory, "candidate"), { recursive: true, force: true })
    }
    if (
      releaseRecordCreated &&
      localRecoveryAccepted &&
      s3RecoveryAccepted &&
      foundationMigrationAccepted
    ) {
      const recordPath = join(directory, "result.json")
      const record = JSON.parse(await readFile(recordPath, "utf8"))
      record.accepted = true
      record.infrastructureImages = infrastructureImages
      record.checks.push(
        "files-publish-and-byte-readback",
        "worker-rollback-actual-source",
        "business-task-worker-rollback-and-recovery",
        "credential-revocation-after-recovery",
        "backup-restore-facts-and-files",
        "s3-private-object-recovery",
        "bookworm-alpine-logical-migration-and-sort"
      )
      record.completedAt = new Date().toISOString()
      await writeFile(recordPath, JSON.stringify(record, null, 2) + "\n")
    }
  })

  it("a real SQL migration failure prevents the first API and SPA deployment", async () => {
    const failed = await publish()
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain("release_gate_failure")
    expect(await imageIDs()).toEqual({
      api: null,
      tenant: null,
      platform: null,
      worker: null,
    })
  })

  it("publishes the previous release, verifies mail, login, proxy boundaries and runtime privileges", async () => {
    await selectImages(oldImages)
    await publishSuccessfully()
    expect(await imageIDs()).toEqual(oldImages)
    owner = await account("发布验收所有者")
    member = await account("发布验收成员")
    operator = await account("发布验收平台管理员")
    for (const name of ["停用验收组织", "撤权验收组织"]) {
      const response = await auth(
        "organization/create",
        { name, slug: randomUUID() },
        owner
      )
      const organization = await response.json()
      if (!suspended) suspended = organization
      else active = organization
      const created = await fetch(
        `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${organization.id}/projects`,
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            origin: env.RELEASE_TENANT_ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "发布前保留的项目",
            description: null,
            contentLocale: "zh-CN",
          }),
        }
      )
      expect(created.status, await created.clone().text()).toBe(201)
    }
    const invitation = await auth(
      "organization/invite-member",
      { organizationId: active.id, email: member.email, role: "member" },
      owner
    )
    const accepted = await auth(
      "organization/accept-invitation",
      { invitationId: (await invitation.json()).id },
      member
    )
    membership = (await accepted.json()).member
    expect((await projects(active, member)).status).toBe(200)
    const workspace = await fileRequest("/workspace")
    expect(workspace.status, await workspace.clone().text()).toBe(200)
    const form = new FormData()
    for (const [key, value] of Object.entries({
      operationId: randomUUID(),
      parentId: (await workspace.json()).root.id,
      name: "release-proof.txt",
      contentSha256: createHash("sha256").update(retainedBytes).digest("hex"),
      declaredBytes: retainedBytes.byteLength,
    }))
      form.append(key, String(value))
    form.append(
      "file",
      new Blob([retainedBytes], { type: "text/plain" }),
      "release-proof.txt"
    )
    const uploaded = await fileRequest("/uploads", {
      method: "POST",
      body: form,
    })
    expect(uploaded.status, await uploaded.clone().text()).toBe(200)
    const uploadedOperation = await uploaded.json()
    const uploadedEntry = await fileRequest(
      `/entries/${uploadedOperation.result.entryId}`
    )
    expect(uploadedEntry.status).toBe(200)
    retainedFile = await uploadedEntry.json()
    await assertRetainedFile()
    await assignment("grant")
    const enabled = await auth(
      "two-factor/enable",
      { password: operator.password, method: "totp" },
      operator
    )
    const secret = new URL((await enabled.json()).totpURI).searchParams.get(
      "secret"
    )
    const verified = await auth(
      "two-factor/verify-totp",
      { code: platformTotp(secret) },
      operator
    )
    const cookies = verified.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    if (cookies) operator.cookie = cookies
    expect((await platformAccess()).status).toBe(200)
    for (const origin of [
      env.RELEASE_TENANT_ORIGIN,
      env.RELEASE_PLATFORM_ORIGIN,
    ]) {
      const missing = await fetch(`${origin}/api/v1/release-missing`)
      expect(missing.status).toBe(404)
      expect(missing.headers.get("content-type")).toContain("application/json")
      expect((await fetch(`${origin}/assets/release-missing.js`)).status).toBe(
        404
      )
    }
    const apiId = await compose("ps", "-q", "api")
    const config = JSON.parse(await checked("docker", ["inspect", apiId]))[0]
      .Config
    expect(config.User).toBe("node")
    expect(
      config.Env.some((value) =>
        /^(MIGRATION_DATABASE_URL|PLATFORM_ASSIGNMENT_DATABASE_URL|POSTGRES_PASSWORD|APP_MIGRATOR_PASSWORD)=/.test(
          value
        )
      )
    ).toBe(false)
  })

  it("keeps the running release on SQL failure and then upgrades immutable application images", async () => {
    const before = await compose("ps", "-q", "api", "tenant", "platform")
    const ledger = await query(
      "SELECT count(*) FROM drizzle.__drizzle_migrations"
    )
    await selectImages(images, failedImage)
    const failed = await publish()
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain("release_gate_failure")
    expect(await compose("ps", "-q", "api", "tenant", "platform")).toBe(before)
    expect(
      await query("SELECT count(*) FROM drizzle.__drizzle_migrations")
    ).toBe(ledger)
    expect((await projects(active, member)).status).toBe(200)
    await selectImages(images)
    await publishSuccessfully()
    expect(await imageIDs()).toEqual(images)
    expect((await projects(suspended, owner)).status).toBe(200)
    expect((await projects(active, member)).status).toBe(200)
    expect((await platformAccess()).status).toBe(200)
  })

  it("rolls back to the accepted images while preserving suspension, membership and platform revocation", async () => {
    await recordBusinessRecoveryFacts()
    expect(await transition("suspend", 1)).toMatchObject({
      status: "SUSPENDED",
      version: 2,
    })
    const access = await fetch(
      `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${active.id}/access`,
      {
        headers: { cookie: owner.cookie },
      }
    )
    expect(access.status).toBe(200)
    const { authorizationVersion } = await access.json()
    // 使用正式访问快照的版本提交移除，保持原生入口的并发约束。
    await auth(
      "organization/remove-member",
      { organizationId: active.id, memberIdOrEmail: membership.id },
      owner,
      { "X-Expected-Authz-Version": String(authorizationVersion) }
    )
    await assignment("revoke")
    expect((await projects(suspended, owner)).status).toBe(403)
    expect((await projects(active, member)).status).toBe(403)
    expect((await platformAccess()).status).toBe(403)
    const ledger = await query(
      "SELECT count(*) FROM drizzle.__drizzle_migrations"
    )
    await selectImages(oldImages)
    await publishSuccessfully()
    expect(await imageIDs()).toEqual(oldImages)
    expect(
      await query("SELECT count(*) FROM drizzle.__drizzle_migrations")
    ).toBe(ledger)
    expect((await projects(suspended, owner)).status).toBe(403)
    expect((await projects(active, member)).status).toBe(403)
    expect((await platformAccess()).status).toBe(403)
    expect(
      await query(
        `SELECT status || ':' || status_version FROM public.organization_status WHERE organization_id='${suspended.id}'`
      )
    ).toBe("SUSPENDED:2")
    expect(
      await query(
        `SELECT count(*) FROM public.member WHERE id='${membership.id}'`
      )
    ).toBe("0")
    expect(
      await query(
        `SELECT status FROM public.platform_assignment WHERE user_id='${operator.user.id}'`
      )
    ).toBe("revoked")
    expect((await projects(active, owner)).status).toBe(200)
    await assertBusinessRecoveryFacts()
    await assertBusinessWorkerAfterRollback()
    await assertRetainedFile()
    const browser = await chromium.launch({ headless: true })
    try {
      const page = await browser.newPage()
      await page.goto(`${env.RELEASE_TENANT_ORIGIN}/app/projects/${active.id}`)
      await expectUI(page.getByLabel("邮箱", { exact: true })).toBeVisible()
      await page.getByLabel("邮箱", { exact: true }).fill(owner.email)
      await page.getByLabel("密码", { exact: true }).fill(owner.password)
      await page.getByRole("button", { name: "登录", exact: true }).click()
      await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
      await page.goto(`${env.RELEASE_TENANT_ORIGIN}/app/projects/${active.id}`)
      await expectUI(
        page.getByRole("link", { name: "发布前保留的项目", exact: true })
      ).toBeVisible()
      await page.reload()
      await expectUI(
        page.getByRole("link", { name: "发布前保留的项目", exact: true })
      ).toBeVisible()
      await page.screenshot({
        path: join(directory, "tenant-rollback.png"),
        fullPage: true,
      })
      await page.goto(
        `${env.RELEASE_TENANT_ORIGIN}/app/projects/${suspended.id}`
      )
      await expectUI(
        page.getByText("该组织已停用", { exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("link", { name: "发布前保留的项目", exact: true })
      ).toHaveCount(0)
      await page.goto(`${env.RELEASE_PLATFORM_ORIGIN}/platform/organizations`)
      await expectUI(
        page.getByRole("heading", { name: "无权访问平台后台", exact: true })
      ).toBeVisible()
      await page.reload()
      await expectUI(
        page.getByRole("heading", { name: "无权访问平台后台", exact: true })
      ).toBeVisible()
      await page.screenshot({
        path: join(directory, "platform-rollback.png"),
        fullPage: true,
      })
      const loggedOut = await page.request.post(
        `${env.RELEASE_PLATFORM_ORIGIN}/api/auth/sign-out`,
        {
          headers: { origin: env.RELEASE_PLATFORM_ORIGIN },
        }
      )
      expect(loggedOut.status()).toBe(200)
      // 拒绝页是公开路由；登出后的进入限制应在受保护入口验证。
      await page.goto(`${env.RELEASE_PLATFORM_ORIGIN}/platform/organizations`)
      await expectUI(page.getByLabel("邮箱", { exact: true })).toBeVisible()
      await page.reload()
      await expectUI(page.getByLabel("邮箱", { exact: true })).toBeVisible()
      expect(
        (
          await page.request.get(
            `${env.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${active.id}/projects`
          )
        ).status()
      ).toBe(401)
    } finally {
      await browser.close()
    }
    // 组织恢复不能重建已移除的成员；平台任职仍单独由部署 CLI 授予和撤销。
    await assignment("grant")
    expect(await transition("resume", 2)).toMatchObject({
      status: "ACTIVE",
      version: 3,
    })
    expect((await projects(suspended, owner)).status).toBe(200)
    expect((await projects(active, member)).status).toBe(403)
    await assignment("revoke")
    expect((await platformAccess()).status).toBe(403)
    await writeFile(
      join(directory, "result.json"),
      JSON.stringify(
        {
          accepted: false,
          sourceArchive,
          sourceArchiveSha256,
          sourceBaseRevision,
          rollbackImages: oldImages,
          candidateImages: images,
          migrationImage,
          checks: [
            "migration-failure-blocks-first-deploy",
            "migration-failure-preserves-running-release",
            "proxy-login-and-runtime-boundaries",
            "rollback-preserves-suspension-and-revocation",
          ],
          completedAt: new Date().toISOString(),
        },
        null,
        2
      )
    )
    releaseRecordCreated = true
  })

  it("maintenance backup restores Files, Redis and authorization facts into new dedicated volumes", async () => {
    await assignment("grant")
    expect(await transition("suspend", 3)).toMatchObject({
      status: "SUSPENDED",
      version: 4,
    })
    await assignment("revoke")
    const backup = join(directory, "backup")
    const backedUp = await command(process.execPath, [
      "infra/release/backup.mjs",
      project,
      join(directory, "release.env"),
      backup,
    ])
    expect(backedUp.status, backedUp.stderr).toBe(0)
    const manifest = JSON.parse(
      await readFile(join(backup, "manifest.json"), "utf8")
    )
    expect(manifest.storage.kind).toBe("local")
    expect(JSON.stringify(manifest)).not.toContain(env.BETTER_AUTH_SECRET)
    expect(JSON.stringify(manifest)).not.toContain(
      env.EMAIL_PAYLOAD_ENCRYPTION_KEY
    )
    const restoredProject = project + "-restored"
    const restoredEnv = {
      ...env,
      RELEASE_MAIL_PORT: await reservePort(),
      RELEASE_OTLP_PORT: await reservePort(),
      RELEASE_PROMETHEUS_PORT: await reservePort(),
      RELEASE_TRACING_PORT: await reservePort(),
    }
    const restoredFile = join(directory, "restored.env")
    await writeFile(
      restoredFile,
      Object.entries(restoredEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
      { mode: 0o600 }
    )
    try {
      const restored = await command(
        process.execPath,
        ["infra/release/restore.mjs", restoredProject, restoredFile, backup],
        { env: { ...process.env, ...restoredEnv } }
      )
      expect(restored.status, restored.stderr).toBe(0)
      await assertRetainedFile()
      await assertBusinessRecoveryFacts()
      await assertBusinessWorkerAfterRollback()
      expect((await projects(active, owner)).status).toBe(200)
      expect((await projects(active, member)).status).toBe(403)
      expect((await projects(suspended, owner)).status).toBe(403)
      expect((await platformAccess()).status).toBe(403)
      const session = await fetch(
        `${env.RELEASE_TENANT_ORIGIN}/api/auth/get-session`,
        { headers: { cookie: owner.cookie } }
      )
      expect((await session.json()).user.id).toBe(owner.user.id)
      localRecoveryAccepted = true
    } finally {
      await command(
        "docker",
        [
          "compose",
          "-p",
          restoredProject,
          "--env-file",
          restoredFile,
          "-f",
          "compose.release.yaml",
          "down",
          "--volumes",
        ],
        { env: { ...process.env, ...restoredEnv } }
      )
      await rm(restoredFile, { force: true })
    }
  })

  it("S3-compatible maintenance snapshot restores private object bytes into an empty namespace", async () => {
    const original = env
    const objectPort = await reservePort()
    const accessKey = randomBytes(12).toString("hex"),
      secretKey = randomBytes(32).toString("hex")
    const storageFile = join(directory, "object-store.env")
    const objectName = project + "-objects"
    const sourceProject = project + "-s3",
      targetProject = sourceProject + "-restored"
    const sourceFile = join(directory, "s3.env"),
      targetFile = join(directory, "s3-restored.env")
    const sourceEnv = {
      ...original,
      RELEASE_API_IMAGE: images.api,
      RELEASE_WORKER_IMAGE: images.worker,
      RELEASE_TENANT_IMAGE: images.tenant,
      RELEASE_PLATFORM_IMAGE: images.platform,
      RELEASE_MIGRATOR_IMAGE: migrationImage,
      RELEASE_TENANT_PORT: await reservePort(),
      RELEASE_PLATFORM_PORT: await reservePort(),
      RELEASE_MAIL_PORT: await reservePort(),
      RELEASE_OTLP_PORT: await reservePort(),
      RELEASE_PROMETHEUS_PORT: await reservePort(),
      RELEASE_TRACING_PORT: await reservePort(),
      FILES_STORAGE_BACKEND: "s3",
      FILES_S3_ENDPOINT: `http://host.docker.internal:${objectPort}`,
      FILES_S3_REGION: "us-east-1",
      FILES_S3_BUCKET: "release-" + randomUUID(),
      FILES_S3_PREFIX: "source",
      FILES_S3_ACCESS_KEY_ID: accessKey,
      FILES_S3_SECRET_ACCESS_KEY: secretKey,
    }
    sourceEnv.RELEASE_TENANT_ORIGIN = `http://127.0.0.1:${sourceEnv.RELEASE_TENANT_PORT}`
    sourceEnv.RELEASE_PLATFORM_ORIGIN = `http://127.0.0.1:${sourceEnv.RELEASE_PLATFORM_PORT}`
    const writeEnvironment = (file, values) =>
      writeFile(
        file,
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") + "\n",
        { mode: 0o600 }
      )
    const run = (args, values = sourceEnv) =>
      checked("docker", args, { env: { ...process.env, ...values } })
    const version = JSON.parse(
      await readFile(
        join(executionRoot, "docs/architecture/versions.json"),
        "utf8"
      )
    ).rustfs.image
    await writeEnvironment(storageFile, {
      RUSTFS_ACCESS_KEY: accessKey,
      RUSTFS_SECRET_KEY: secretKey,
      RUSTFS_ADDRESS: ":9000",
      RUSTFS_CONSOLE_ENABLE: "false",
    })
    await writeEnvironment(sourceFile, sourceEnv)
    const client = new S3Client({
      endpoint: `http://127.0.0.1:${objectPort}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    })
    try {
      await run([
        "run",
        "-d",
        "--name",
        objectName,
        "--env-file",
        storageFile,
        "-p",
        `127.0.0.1:${objectPort}:9000`,
        version,
        "/data",
      ])
      await expect
        .poll(
          async () => {
            try {
              return (
                await fetch(`http://127.0.0.1:${objectPort}/health/ready`)
              ).status
            } catch {
              return 0
            }
          },
          { timeout: 30_000 }
        )
        .toBe(200)
      await client.send(
        new CreateBucketCommand({ Bucket: sourceEnv.FILES_S3_BUCKET })
      )
      const deployed = await command(
        process.execPath,
        ["infra/release/publish.mjs", sourceProject, sourceFile],
        { env: { ...process.env, ...sourceEnv } }
      )
      expect(deployed.status, deployed.stderr).toBe(0)
      env = sourceEnv
      const actor = await account("S3恢复所有者")
      const orgResponse = await auth(
        "organization/create",
        { name: "S3恢复组织", slug: randomUUID() },
        actor
      )
      const organization = await orgResponse.json()
      const base = `${sourceEnv.RELEASE_TENANT_ORIGIN}/api/v1/organizations/${organization.id}/files`
      const headers = {
        cookie: actor.cookie,
        origin: sourceEnv.RELEASE_TENANT_ORIGIN,
      }
      const workspace = await fetch(base + "/workspace", { headers })
      expect(workspace.status).toBe(200)
      const body = Buffer.from("S3一致快照与恢复的真实内容\n")
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        parentId: (await workspace.json()).root.id,
        name: "restore.txt",
        declaredBytes: body.byteLength,
        contentSha256: createHash("sha256").update(body).digest("hex"),
      }))
        form.append(key, String(value))
      form.append(
        "file",
        new Blob([body], { type: "text/plain" }),
        "restore.txt"
      )
      const uploaded = await fetch(base + "/uploads", {
        method: "POST",
        headers,
        body: form,
      })
      expect(uploaded.status, await uploaded.clone().text()).toBe(200)
      const receipt = await uploaded.json()
      const backup = join(directory, "s3-backup")
      const captured = await command(
        process.execPath,
        ["infra/release/backup.mjs", sourceProject, sourceFile, backup],
        { env: { ...process.env, ...sourceEnv } }
      )
      expect(captured.status, captured.stderr).toBe(0)
      const targetEnv = {
        ...sourceEnv,
        FILES_S3_PREFIX: "restored",
        RELEASE_MAIL_PORT: await reservePort(),
        RELEASE_OTLP_PORT: await reservePort(),
        RELEASE_PROMETHEUS_PORT: await reservePort(),
        RELEASE_TRACING_PORT: await reservePort(),
      }
      await writeEnvironment(targetFile, targetEnv)
      const recovered = await command(
        process.execPath,
        ["infra/release/restore.mjs", targetProject, targetFile, backup],
        { env: { ...process.env, ...targetEnv } }
      )
      expect(recovered.status, recovered.stderr).toBe(0)
      const content = await fetch(
        `${base}/entries/${receipt.result.entryId}/versions/${receipt.result.versionId}/content`,
        { headers }
      )
      expect(content.status).toBe(200)
      expect(Buffer.from(await content.arrayBuffer())).toEqual(body)
      s3RecoveryAccepted = true
    } finally {
      env = original
      client.destroy()
      for (const [name, file] of [
        [sourceProject, sourceFile],
        [targetProject, targetFile],
      ])
        await command(
          "docker",
          [
            "compose",
            "-p",
            name,
            "--env-file",
            file,
            "-f",
            "compose.release.yaml",
            "down",
            "--volumes",
          ],
          { env: { ...process.env, ...sourceEnv } }
        )
      await command("docker", ["rm", "-f", objectName])
      for (const file of [storageFile, sourceFile, targetFile])
        await rm(file, { force: true })
    }
  })

  it("Bookworm停写快照通过正式基础迁移CLI在Alpine新卷保留业务事实并采用目标排序", async () => {
    const saved = {
      env,
      owner,
      active,
      retainedFile,
      retainedBusinessTask,
      revokedReleaseCredential,
    }
    const legacyRoot = join(directory, "bookworm-source")
    await mkdir(legacyRoot)
    await cp(join(executionRoot, "infra"), join(legacyRoot, "infra"), {
      recursive: true,
    })
    const postgres =
      "postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af"
    const redis =
      "redis:7.4.5-bookworm@sha256:90e7a336d044f1abc9e9dbc05d65566850896d11453bbd1dd0fb7e5059f0e8fb"
    for (const image of [postgres, redis])
      await checked("docker", ["pull", image])
    const sourceCompose = (
      await readFile(join(executionRoot, "compose.release.yaml"), "utf8")
    )
      .replace(
        /^    image: enterprise-admin-postgres:.*$/m,
        `    image: ${postgres}`
      )
      .replace(/^    image: enterprise-admin-redis:.*$/m, `    image: ${redis}`)
    await writeFile(join(legacyRoot, "compose.release.yaml"), sourceCompose)
    const sourceProject = project + "-bookworm",
      targetProject = project + "-alpine-migrated"
    const sourceFile = join(directory, "bookworm.env"),
      targetFile = join(directory, "alpine-migrated.env")
    const tenantPort = await reservePort(),
      platformPort = await reservePort()
    const sourceEnv = {
      ...saved.env,
      RELEASE_MIGRATOR_IMAGE: migrationImage,
      ...Object.fromEntries(
        Object.entries(images).map(([service, image]) => [
          `RELEASE_${service.toUpperCase()}_IMAGE`,
          image,
        ])
      ),
      RELEASE_TENANT_PORT: tenantPort,
      RELEASE_PLATFORM_PORT: platformPort,
      RELEASE_TENANT_ORIGIN: `http://127.0.0.1:${tenantPort}`,
      RELEASE_PLATFORM_ORIGIN: `http://127.0.0.1:${platformPort}`,
      RELEASE_MAIL_PORT: await reservePort(),
      RELEASE_OTLP_PORT: await reservePort(),
      RELEASE_PROMETHEUS_PORT: await reservePort(),
      RELEASE_TRACING_PORT: await reservePort(),
    }
    await writeEnvironment(sourceFile, sourceEnv)
    const targetEnv = {
      ...sourceEnv,
      RELEASE_MAIL_PORT: await reservePort(),
      RELEASE_OTLP_PORT: await reservePort(),
      RELEASE_PROMETHEUS_PORT: await reservePort(),
      RELEASE_TRACING_PORT: await reservePort(),
    }
    await writeEnvironment(targetFile, targetEnv)
    try {
      const published = await command(
        process.execPath,
        [
          join(executionRoot, "infra/release/publish.mjs"),
          sourceProject,
          sourceFile,
        ],
        { cwd: legacyRoot, env: { ...process.env, ...sourceEnv } }
      )
      expect(published.status, published.stderr).toBe(0)
      env = sourceEnv
      owner = await account("基础迁移所有者")
      const created = await auth(
        "organization/create",
        { name: "基础迁移组织", slug: randomUUID() },
        owner
      )
      expect(created.status).toBe(200)
      active = await created.json()
      const names = ["Z", "ä", "Å", "a", "a-a", "a_a", "北京"].map(
        (value) => `foundation-${value}`
      )
      await completedBusinessTask("imports", {
        format: "csv",
        contentBase64: Buffer.from(
          "name,description,contentLocale\n" +
            names.map((name) => `${name},,zh-CN`).join("\n") +
            "\n"
        ).toString("base64"),
      })
      await recordBusinessRecoveryFacts()
      const workspace = await fileRequest("/workspace")
      expect(workspace.status).toBe(200)
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        parentId: (await workspace.json()).root.id,
        name: "foundation-proof.txt",
        contentSha256: createHash("sha256").update(retainedBytes).digest("hex"),
        declaredBytes: retainedBytes.byteLength,
      }))
        form.append(key, String(value))
      form.append(
        "file",
        new Blob([retainedBytes], { type: "text/plain" }),
        "foundation-proof.txt"
      )
      const uploaded = await fileRequest("/uploads", {
        method: "POST",
        body: form,
      })
      expect(uploaded.status).toBe(200)
      const receipt = await uploaded.json()
      retainedFile = await (
        await fileRequest(`/entries/${receipt.result.entryId}`)
      ).json()
      const backup = join(directory, "foundation-backup")
      const captured = await command(
        process.execPath,
        [
          join(executionRoot, "infra/release/backup.mjs"),
          sourceProject,
          sourceFile,
          backup,
        ],
        { cwd: legacyRoot, env: { ...process.env, ...sourceEnv } }
      )
      expect(captured.status, captured.stderr).toBe(0)
      const migrated = await command(
        process.execPath,
        [
          "infra/release/migrate-foundation.mjs",
          targetProject,
          targetFile,
          backup,
        ],
        { env: { ...process.env, ...targetEnv } }
      )
      expect(migrated.status, migrated.stderr).toBe(0)
      env = targetEnv
      await assertRetainedFile()
      await assertBusinessRecoveryFacts()
      await assertBusinessWorkerAfterRollback()
      const sorted = await businessRequest("/projects?name=foundation-")
      expect(sorted.status).toBe(200)
      const migratedNames = (await sorted.json()).items.map((item) => item.name)
      expect(migratedNames).toHaveLength(7)
      expect(migratedNames).toEqual(expect.arrayContaining(names))
      const session = await fetch(
        `${env.RELEASE_TENANT_ORIGIN}/api/auth/get-session`,
        { headers: { cookie: owner.cookie } }
      )
      expect((await session.json()).user.id).toBe(owner.user.id)
      const report = JSON.parse(
        await readFile(join(backup, "foundation-migration.json"), "utf8")
      )
      expect(report.source.database.os.id).toBe("debian")
      expect(report.target.database.os.id).toBe("alpine")
      expect(report.target.database.serverVersionNum).toBe(180006)
      expect(report.target.database.sortingProbe).toEqual([
        "Z",
        "a",
        "a-a",
        "a_a",
        "Å",
        "ä",
        "北京",
      ])
      expect(report.invalidIndexes).toBe(0)
      foundationMigrationAccepted = true
    } finally {
      for (const [name, file, cwd] of [
        [sourceProject, sourceFile, legacyRoot],
        [targetProject, targetFile, executionRoot],
      ])
        await command(
          "docker",
          [
            "compose",
            "-p",
            name,
            "--env-file",
            file,
            "-f",
            "compose.release.yaml",
            "down",
            "--volumes",
          ],
          { cwd, env: { ...process.env, ...sourceEnv } }
        )
      for (const file of [sourceFile, targetFile])
        await rm(file, { force: true })
      ;({
        env,
        owner,
        active,
        retainedFile,
        retainedBusinessTask,
        revokedReleaseCredential,
      } = saved)
    }
  })
})
