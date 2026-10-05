import { spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, expect as expectUI } from "playwright/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { firstHttpUrl, waitForMail } from "../setup/mailpit.mjs"
import { platformTotp } from "../setup/platform-operator.mjs"

const rollbackRef = process.env.RELEASE_ROLLBACK_REF
const project = `enterprise-release-${randomBytes(6).toString("hex")}`
const root = process.cwd()
let directory, env, oldImages, images, failedImage, migrationImage
let owner, member, operator, suspended, active, membership

async function command(file, args, options = {}) {
  const child = spawn(file, args, {
    cwd: root,
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
  expect(result.stdout).toContain("migrator → API → SPA")
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
  for (const target of ["api", "tenant", "platform"]) {
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
  for (const service of ["api", "tenant", "platform"]) {
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
    directory = await mkdtemp(join(tmpdir(), "enterprise-admin-release-"))
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
    await cp("infra/release", join(previous, "infra/release"), {
      recursive: true,
    })
    await cp(".dockerignore", join(previous, ".dockerignore"))
    images = await applicationImages(root, "local-candidate", "candidate")
    oldImages = await applicationImages(previous, revision, "previous")
    const migratorTag = `${project}:migrator`
    migrationImage = await build(
      root,
      "infra/release/Dockerfile",
      "migrator",
      migratorTag,
      "local-candidate"
    )
    const failure = join(directory, "failure")
    await mkdir(join(failure, "meta"), { recursive: true })
    const journal = JSON.parse(
      await readFile("packages/database/migrations/meta/_journal.json", "utf8")
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
          accepted: true,
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
  })
})
