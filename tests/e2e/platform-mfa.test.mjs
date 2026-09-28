import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { execFile } from "node:child_process"
import { createHmac, randomBytes, randomUUID } from "node:crypto"
import { promisify } from "node:util"
import { expect as expectUI } from "playwright/test"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const exec = promisify(execFile)

function totp(secret, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
  const bits = [...secret.toUpperCase().replace(/=+$/, "")]
    .map((character) =>
      alphabet.indexOf(character).toString(2).padStart(5, "0")
    )
    .join("")
  const key = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
    )
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const digest = createHmac("sha1", key).update(counter).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, "0")
}

function account(name) {
  return {
    name,
    email: `${randomUUID()}@example.test`,
    password: randomBytes(24).toString("hex"),
  }
}

describe("platform MFA browser flow", () => {
  let environment
  let browser
  let page
  let platformOrigin

  async function grant(target, role) {
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
        role,
        "--reason",
        "browser MFA acceptance",
      ],
      {
        env: {
          PATH: process.env.PATH,
          PLATFORM_ASSIGNMENT_DATABASE_URL: environment.deployerURL,
        },
      }
    )
  }

  async function signIn(target) {
    await page.getByLabel("邮箱", { exact: true }).fill(target.email)
    await page.getByLabel("密码", { exact: true }).fill(target.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
  }

  async function selectArabic() {
    await page.getByRole("button", { name: "语言", exact: true }).click()
    await page
      .getByRole("menuitemradio", { name: "العربية", exact: true })
      .click()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
  }

  async function signInArabic(target) {
    await page
      .getByLabel("البريد الإلكتروني", { exact: true })
      .fill(target.email)
    await page.getByLabel("كلمة المرور", { exact: true }).fill(target.password)
    await page
      .getByRole("button", { name: "تسجيل الدخول", exact: true })
      .click()
  }

  beforeAll(async () => {
    environment = await startBrowserApplication()
    ;({ browser, platformOrigin } = environment)
  })

  afterAll(async () => {
    await environment?.close()
  })

  it("keeps an unassigned user's platform content hidden", async () => {
    const target = account("普通用户")
    const registered = await signUpVerified(
      environment.baseURL,
      platformOrigin,
      environment.migrator,
      target
    )
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [registered.user.id, "ar"]
    )
    page = await browser.newPage()
    await page.goto(`${platformOrigin}/platform`)
    await selectArabic()
    await signInArabic(target)
    await expectUI(
      page.getByRole("heading", {
        name: "لا يمكن الوصول إلى إدارة المنصة",
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByText("لا يملك هذا الحساب تكليفًا نشطًا في المنصة.", {
        exact: true,
      })
    ).toBeVisible()
    await expectUI(
      page.getByText("ميزات المنصة غير متاحة بعد.", { exact: true })
    ).toHaveCount(0)
    const switchAccount = page.getByRole("button", {
      name: "تسجيل الخروج واستخدام حساب آخر لتسجيل الدخول",
      exact: true,
    })
    await switchAccount.focus()
    await page.keyboard.press("Enter")
    await expectUI(page).toHaveURL(/\/login$/)
    await expectUI(
      page.getByLabel("البريد الإلكتروني", { exact: true })
    ).toBeVisible()
  }, 120_000)

  it("enrolls TOTP before showing the platform shell and challenges subsequent sign-ins", async () => {
    const target = account("平台管理员")
    const registered = await signUpVerified(
      environment.baseURL,
      platformOrigin,
      environment.migrator,
      target
    )
    await grant(registered, "platform_admin")

    page = await browser.newPage()
    await page.goto(`${platformOrigin}/platform`)
    await signIn(target)
    await expectUI(
      page.getByRole("heading", { name: "设置平台双重验证", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByText("平台功能尚未开放。", { exact: true })
    ).toHaveCount(0)

    await page.getByLabel("密码", { exact: true }).fill(target.password)
    await page
      .getByRole("button", { name: "生成 TOTP 密钥", exact: true })
      .click()
    const uriInput = page.getByLabel("身份验证器配置 URI", { exact: true })
    await expectUI(uriInput).toBeVisible()
    const secret = new URL(await uriInput.inputValue()).searchParams.get(
      "secret"
    )
    expect(secret).toBeTruthy()
    await page.getByLabel("6 位验证码", { exact: true }).fill(totp(secret))
    await page.getByRole("button", { name: "验证并继续", exact: true }).click()
    await expectUI(
      page.getByText("平台管理员 · 全平台范围", { exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByText("平台功能尚未开放。", { exact: true })
    ).toBeVisible()
    await environment.migrator.query(
      'UPDATE public."user" SET preferred_locale = $2 WHERE id = $1',
      [registered.user.id, "ar"]
    )

    await page.context().request.post(`${platformOrigin}/api/auth/sign-out`, {
      headers: { origin: platformOrigin },
    })
    await page.goto(`${platformOrigin}/login`)
    await selectArabic()
    await signInArabic(target)
    await expectUI(
      page.getByRole("heading", {
        name: "تحقق من هويتك على المنصة",
        exact: true,
      })
    ).toBeVisible()
    const codeInput = page.getByLabel("رمز من ستة أرقام", { exact: true })
    const verifyButton = page.getByRole("button", {
      name: "تحقق وتابع",
      exact: true,
    })

    await codeInput.focus()
    await page.keyboard.type("123")
    await page.keyboard.press("Tab")
    await expectUI(verifyButton).toBeFocused()
    await page.keyboard.press("Enter")
    await expectUI(codeInput).toHaveAttribute("aria-invalid", "true")
    await expectUI(page.getByRole("alert")).toHaveText(
      "أدخل الرمز الحالي المكوّن من ستة أرقام من تطبيق المصادقة."
    )

    const wrongCode = totp(secret) === "000000" ? "000001" : "000000"
    await codeInput.fill(wrongCode)
    await codeInput.press("Tab")
    await expectUI(verifyButton).toBeFocused()
    await page.keyboard.press("Enter")
    await expectUI(page.getByRole("alert")).toHaveText(
      "تعذر التحقق. راجع كلمة المرور أو الرمز وحاول مرة أخرى."
    )

    await codeInput.fill(totp(secret))
    await codeInput.press("Tab")
    await expectUI(verifyButton).toBeFocused()
    await page.keyboard.press("Enter")
    await expectUI(page).toHaveURL(/\/platform$/)
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(
      page.getByText("مسؤول المنصة · نطاق المنصة بالكامل", { exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByText("ميزات المنصة غير متاحة بعد.", { exact: true })
    ).toBeVisible()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "ar")
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
  }, 120_000)
})
