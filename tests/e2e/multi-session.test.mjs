import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"
import { expect as expectUI } from "playwright/test"
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest"

let environment, page
const exec = promisify(execFile)

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...secret]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("")
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, i) =>
      Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2)
    )
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const digest = createHmac("sha1", key).update(counter).digest()
  return ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1_000_000)
    .toString()
    .padStart(6, "0")
}

async function account(name, origin) {
  return signUpVerified(environment.baseURL, origin, environment.migrator, {
    name,
  })
}

async function signIn(target) {
  await page.getByLabel("邮箱", { exact: true }).fill(target.email)
  await page.getByLabel("密码", { exact: true }).fill(target.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
}

async function openMenu(target) {
  await page.getByRole("button", { name: new RegExp(target.user.name) }).click()
  await expectUI(page.getByRole("menuitem", { name: /切换账号/ })).toBeVisible()
}

async function openAccountMenu(target) {
  await openMenu(target)
  await page.getByRole("menuitem", { name: /切换账号/ }).click()
  await expectUI(
    page.getByRole("menuitemradio", { name: new RegExp(target.email) })
  ).toBeVisible()
}

async function addAccount(current, next) {
  await openAccountMenu(current)
  await page.getByRole("menuitem", { name: "添加账号", exact: true }).click()
  await expectUI(page).toHaveURL(/\/add-account$/)
  await signIn(next)
}

async function switchAccount(current, next) {
  await openAccountMenu(current)
  await page
    .getByRole("menuitemradio", { name: new RegExp(next.email) })
    .click()
  await expectUI(
    page.getByRole("button", { name: new RegExp(next.user.name) })
  ).toBeVisible()
}

async function session(origin) {
  const response = await page.request.get(`${origin}/api/auth/get-session`)
  expect(response.status()).toBe(200)
  return response.json()
}

async function grant(target) {
  await exec(
    process.execPath,
    [
      "apps/api/dist/console.js",
      "platform",
      "assignment",
      "grant",
      "--user-id",
      target.user.id,
      "--role",
      "platform_admin",
      "--reason",
      "multi-session browser acceptance",
    ],
    {
      env: {
        PATH: process.env.PATH,
        PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
      },
    }
  )
}

async function enrollMfa(target) {
  await expectUI(
    page.getByRole("heading", { name: "设置平台双重验证", exact: true })
  ).toBeVisible()
  await page.getByLabel("密码", { exact: true }).fill(target.password)
  await page
    .getByRole("button", { name: "生成 TOTP 密钥", exact: true })
    .click()
  const uri = page.getByLabel("身份验证器配置 URI", { exact: true })
  await expectUI(uri).toBeVisible()
  const secret = new URL(await uri.inputValue()).searchParams.get("secret")
  await page.getByLabel("6 位验证码", { exact: true }).fill(totp(secret))
  await page.getByRole("button", { name: "验证并继续", exact: true }).click()
  await expectUI(
    page.getByRole("button", { name: new RegExp(target.user.name) })
  ).toBeVisible()
  return secret
}

beforeAll(async () => {
  environment = await startBrowserApplication()
  await mkdir("test-results/multi-session", { recursive: true })
})

beforeEach(async () => {
  page = await environment.browser.newPage({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
  })
})

afterEach(async ({ task }) => {
  if (task.result?.state === "fail") {
    console.error(
      "Multi-session page",
      page.url(),
      await page.locator("body").innerText()
    )
    await page.screenshot({
      path: `test-results/multi-session/${task.id}.png`,
      fullPage: true,
    })
  }
  await page.context().close()
})

afterAll(async () => {
  await environment?.close()
})

it("添加账号的 GitHub 授权成功回跳指向后台入口", async () => {
  const origin = environment.tenantOrigin
  await page.route("https://github.com/login/oauth/authorize**", (route) =>
    route.fulfill({ contentType: "text/html", body: "OAuth provider probe" })
  )
  await page.goto(`${origin}/add-account`)
  const initiated = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/auth/sign-in/social"
  )
  const authorize = page.waitForRequest(
    (request) => new URL(request.url()).origin === "https://github.com"
  )
  await page
    .getByRole("button", { name: "使用 GitHub 登录", exact: true })
    .click()
  expect((await initiated).postDataJSON().callbackURL).toBe(`${origin}/`)
  expect(new URL((await authorize).url()).searchParams.get("client_id")).toBe(
    "test-github-client-id"
  )
})

it("租户后台添加、取消、切换和退出账号时隔离组织及会话", async () => {
  const origin = environment.tenantOrigin
  const first = await account("租户账号 A", origin)
  const second = await account("租户账号 B", origin)
  const orgs = []
  for (const target of [first, second]) {
    orgs.push(
      await environment.runtime.auth.api.createOrganization({
        headers: target.headers,
        body: { name: `隔离组织 ${orgs.length + 1}`, slug: randomUUID() },
      })
    )
  }
  await page.goto(`${origin}/login`)
  await signIn(first)
  await openAccountMenu(first)
  await page.getByRole("menuitem", { name: "添加账号", exact: true }).click()
  await page.getByRole("link", { name: "取消添加账号", exact: true }).click()
  await expectUI(
    page.getByRole("button", { name: new RegExp(first.user.name) })
  ).toBeVisible()
  expect((await session(origin)).user.id).toBe(first.user.id)

  await addAccount(first, second)
  await expectUI(
    page.getByRole("button", { name: new RegExp(second.user.name) })
  ).toBeVisible()
  expect((await session(origin)).user.id).toBe(second.user.id)
  await expectUI(
    page.getByRole("button", { name: new RegExp(orgs[1].name) })
  ).toBeVisible()
  const forbidden = await page.request.get(
    `${origin}/api/v1/organizations/${orgs[0].id}/access`
  )
  expect(forbidden.status()).toBe(403)

  await openAccountMenu(second)
  await page.screenshot({
    path: "test-results/multi-session/tenant-accounts.png",
    fullPage: true,
  })
  await page.keyboard.press("Escape")
  await switchAccount(second, first)
  expect((await session(origin)).user.id).toBe(first.user.id)
  await expectUI(
    page.getByRole("button", { name: new RegExp(orgs[0].name) })
  ).toBeVisible()

  const invalidSwitch = await page.request.post(
    `${origin}/api/auth/multi-session/set-active`,
    { headers: { origin }, data: { sessionToken: randomUUID() } }
  )
  expect(invalidSwitch.status()).toBe(401)
  const untrusted = await page.request.post(
    `${origin}/api/auth/multi-session/set-active`,
    {
      headers: { origin: "https://untrusted.example" },
      data: { sessionToken: (await session(origin)).session.token },
    }
  )
  expect(untrusted.status()).toBe(403)

  await openMenu(first)
  await page
    .getByRole("menuitem", { name: "退出当前账号", exact: true })
    .click()
  await expectUI(
    page.getByRole("button", { name: new RegExp(second.user.name) })
  ).toBeVisible()
  expect((await session(origin)).user.id).toBe(second.user.id)
  let list = await (
    await page.request.get(
      `${origin}/api/auth/multi-session/list-device-sessions`
    )
  ).json()
  expect(list.map((entry) => entry.user.id)).toEqual([second.user.id])

  await addAccount(second, first)
  await expectUI(
    page.getByRole("button", { name: new RegExp(first.user.name) })
  ).toBeVisible()
  list = await (
    await page.request.get(
      `${origin}/api/auth/multi-session/list-device-sessions`
    )
  ).json()
  expect(list).toHaveLength(2)
  await openMenu(first)
  await page
    .getByRole("menuitem", { name: "退出所有账号", exact: true })
    .click()
  await expectUI(page).toHaveURL(/\/login$/)
  expect(await session(origin)).toBeNull()
  expect(
    (
      await environment.migrator.query(
        "SELECT 1 FROM session WHERE token = ANY($1::text[])",
        [list.map((entry) => entry.session.token)]
      )
    ).rowCount
  ).toBe(0)
}, 120_000)

it("平台后台切换保留各自 MFA，租户添加已启用 MFA 的账号仍须完成挑战", async () => {
  const origin = environment.platformOrigin
  const first = await account("平台账号 A", origin)
  const second = await account("平台账号 B", origin)
  await grant(first)
  await grant(second)
  await page.goto(`${origin}/login`)
  await signIn(first)
  await enrollMfa(first)
  await addAccount(first, second)
  const secondSecret = await enrollMfa(second)
  await openAccountMenu(second)
  await page.screenshot({
    path: "test-results/multi-session/platform-accounts.png",
    fullPage: true,
  })
  await page.keyboard.press("Escape")
  await switchAccount(second, first)
  expect((await session(origin)).user.id).toBe(first.user.id)
  expect(
    (await page.request.get(`${origin}/api/v1/me/platform`)).status()
  ).toBe(200)
  await switchAccount(first, second)
  expect((await session(origin)).user.id).toBe(second.user.id)
  expect(
    (await page.request.get(`${origin}/api/v1/me/platform`)).status()
  ).toBe(200)
  await openMenu(second)
  await page
    .getByRole("menuitem", { name: "退出当前账号", exact: true })
    .click()
  await expectUI(
    page.getByRole("button", { name: new RegExp(first.user.name) })
  ).toBeVisible()

  // 两个预览站使用同一 host，Cookie 不按端口隔离；租户入口必须处理该账号的原生 MFA 挑战。
  await page.goto(`${environment.tenantOrigin}/add-account`)
  await signIn(second)
  await expectUI(page).toHaveURL(/\/mfa$/)
  const pendingSessions = await (
    await page.request.get(
      `${origin}/api/auth/multi-session/list-device-sessions`
    )
  ).json()
  expect(pendingSessions.map((entry) => entry.user.id)).toEqual([first.user.id])
  await page.getByLabel("6 位验证码", { exact: true }).fill(totp(secondSecret))
  await page.getByRole("button", { name: "验证并继续", exact: true }).click()
  await expectUI(page).toHaveURL(/\/app(?:\/|$)/)
  await expectUI(
    page.getByRole("button", { name: "切换账号", exact: true })
  ).toBeVisible()
  expect((await session(environment.tenantOrigin)).user.id).toBe(second.user.id)

  await page.goto(`${origin}/platform`)
  await expectUI(
    page.getByRole("button", { name: new RegExp(second.user.name) })
  ).toBeVisible()
  await openMenu(second)
  await page
    .getByRole("menuitem", { name: "退出所有账号", exact: true })
    .click()
  await expectUI(page).toHaveURL(/\/login$/)
  expect(await session(origin)).toBeNull()
}, 120_000)

it("新增无平台任职的账号后能从拒绝页切回已授权账号", async () => {
  const origin = environment.platformOrigin
  const admin = await account("平台账号 C", origin)
  const ordinary = await account("普通租户账号", origin)
  await grant(admin)
  await page.goto(`${origin}/login`)
  await signIn(admin)
  await enrollMfa(admin)
  await addAccount(admin, ordinary)
  await expectUI(
    page.getByRole("heading", { name: "无权访问平台后台", exact: true })
  ).toBeVisible()
  expect(
    (await page.request.get(`${origin}/api/v1/me/platform`)).status()
  ).toBe(403)
  await page.getByRole("button", { name: "切换账号", exact: true }).click()
  await page
    .getByRole("menuitemradio", { name: new RegExp(admin.email) })
    .click()
  await expectUI(
    page.getByRole("button", { name: new RegExp(admin.user.name) })
  ).toBeVisible()
  expect((await session(origin)).user.id).toBe(admin.user.id)
}, 120_000)
