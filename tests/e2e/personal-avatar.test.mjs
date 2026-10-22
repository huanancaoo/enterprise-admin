import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { expect as expectUI } from "playwright/test"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { startPersonalAvatarBrowser } from "../setup/personal-avatar-runtime.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const sharp = require("sharp")
const storybookRequire = createRequire(resolve("apps/storybook/package.json"))
const a11yRequire = createRequire(
  storybookRequire.resolve("@storybook/addon-a11y")
)
const images = Object.fromEntries(
  await Promise.all(
    ["png", "jpeg", "webp", "gif"].map(async (format) => [
      format,
      await sharp({
        create: {
          width: 3,
          height: 2,
          channels: 3,
          background: { r: 35, g: 112, b: 180 },
        },
      })
        .toFormat(format)
        .toBuffer(),
    ])
  )
)
const sha = (body) => createHash("sha256").update(body).digest("hex")
const personalPath = "/app/settings/preferences"
const canonical = (id) => `/api/v1/personal-media/${id}/content`

async function attach(context, cookie, origin) {
  await context.addCookies(
    cookie.split("; ").map((part) => {
      const separator = part.indexOf("=")
      return {
        name: part.slice(0, separator),
        value: part.slice(separator + 1),
        url: origin,
        httpOnly: true,
        sameSite: "Lax",
      }
    })
  )
}
async function selectFile(page, name, mimeType, body) {
  await page
    .getByLabel("选择头像图片")
    .setInputFiles({ name, mimeType, buffer: body })
}
async function choose(page, format = "png", body = images[format]) {
  await selectFile(
    page,
    `头像.${format}`,
    format === "jpeg" ? "image/jpeg" : `image/${format}`,
    body
  )
  await expectUI(page.getByAltText("新头像预览")).toBeVisible()
}
async function saveSelected(
  page,
  format = "png",
  body = images[format],
  beforeSave = async () => {}
) {
  await choose(page, format)
  await beforeSave()
  const uploadResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/v1/personal-media"
  )
  const saveResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === "/api/v1/personal-media/avatar"
  )
  await page.getByRole("button", { name: "保存头像", exact: true }).click()
  const upload = await uploadResponse
  const response = await saveResponse
  expect(upload.status(), await upload.text()).toBe(201)
  const candidate = await upload.json()
  expect(upload.request().headers()["content-type"]).toBe(
    format === "jpeg" ? "image/jpeg" : `image/${format}`
  )
  expect(response.status(), await response.text()).toBe(200)
  await expectUI(page.getByRole("status")).toHaveText("头像设置已保存。")
  return { candidate, receipt: await response.json() }
}
async function save(page, remove = false) {
  const response = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === "/api/v1/personal-media/avatar"
  )
  await page
    .getByRole("button", {
      name: remove ? "移除头像" : "保存头像",
      exact: true,
    })
    .click()
  const result = await response
  expect(result.status(), await result.text()).toBe(200)
  await expectUI(page.getByRole("status")).toHaveText("头像设置已保存。")
  return result.json()
}
async function decoded(locator) {
  await expectUI(locator).toBeVisible()
  await expectUI
    .poll(() =>
      locator.evaluate(
        (node) =>
          node.complete && node.naturalWidth > 0 && node.src.startsWith("blob:")
      )
    )
    .toBe(true)
}
function memberDirectory(page) {
  return page.getByRole("table").filter({
    has: page.getByRole("columnheader", { name: "成员账号", exact: true }),
  })
}
async function selectLocale(page, name, option, languageLabel = "语言") {
  await page.getByRole("button", { name: new RegExp(name) }).click()
  const language = page.getByRole("menuitem", {
    name: languageLabel,
    exact: true,
  })
  await language.focus()
  const direction = await page.locator("html").getAttribute("dir")
  await language.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight")
  const choice = page.getByRole("menuitemradio", { name: option, exact: true })
  await expectUI(choice).toBeVisible()
  await choice.focus()
  await expectUI(choice).toBeFocused()
  await page.keyboard.press("Enter")
  // 旧菜单退出时会归还焦点，下一次选择必须等待它完成卸载。
  await expectUI(page.getByRole("menu", { includeHidden: true })).toHaveCount(0)
}

describe.each(["Local", "RustFS"])("个人头像正式产品 / %s", (backend) => {
  const resources = new AsyncDisposableStack()
  let environment, context, page
  beforeAll(async () => {
    try {
      environment = await startPersonalAvatarBrowser(backend, resources)
    } catch (error) {
      try {
        await resources.disposeAsync()
      } catch (cleanupError) {
        throw new SuppressedError(
          cleanupError,
          error,
          "个人头像浏览器启动和释放失败"
        )
      }
      throw error
    }
  })
  beforeEach(async () => {
    context = await environment.browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    page = await context.newPage()
  })
  afterEach(() => context?.close())
  afterAll(() => resources.disposeAsync())

  async function account(name = "头像用户") {
    return signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name }
    )
  }
  async function current(actor) {
    const result = await environment.observer.query(
      'SELECT image FROM public."user" WHERE id=$1',
      [actor.user.id]
    )
    return result.rows[0].image
  }
  async function organization(owner, viewer, role = "member") {
    const org = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "头像验收组织", slug: randomUUID() },
    })
    if (viewer)
      await environment.runtime.auth.api.addMember({
        headers: owner.headers,
        body: { organizationId: org.id, userId: viewer.user.id, role },
      })
    return org
  }
  async function content(actor, mediaId, organizationId) {
    return fetch(
      environment.baseURL +
        canonical(mediaId) +
        (organizationId ? `?organizationId=${organizationId}` : ""),
      { headers: { cookie: actor.cookie, origin: environment.tenantOrigin } }
    )
  }
  async function outsideUpload(actor, format = "png") {
    const result = await fetch(environment.baseURL + "/api/v1/personal-media", {
      method: "POST",
      headers: {
        cookie: actor.cookie,
        origin: environment.tenantOrigin,
        "content-type": format === "jpeg" ? "image/jpeg" : `image/${format}`,
        "Idempotency-Key": randomUUID(),
      },
      body: images[format],
    })
    expect(result.status, await result.clone().text()).toBe(201)
    return result.json()
  }
  async function outsideSave(actor, mediaId, expectedImage) {
    const result = await fetch(
      environment.baseURL + "/api/v1/personal-media/avatar",
      {
        method: "PUT",
        headers: {
          cookie: actor.cookie,
          origin: environment.tenantOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mediaId,
          expectedImage,
          idempotencyKey: randomUUID(),
        }),
      }
    )
    expect(result.status, await result.clone().text()).toBe(200)
    return result.json()
  }
  async function ownNav(target) {
    return decoded(
      target
        .locator('[data-slot="sidebar-footer"] [data-personal-avatar] img')
        .first()
    )
  }

  it("四种格式一次保存后经两个后台更换、刷新、成员目录读取及显式移除", async () => {
    const owner = await platformOperator(
      environment,
      environment.platformOrigin
    )
    const viewer = await account("头像目录读者")
    const org = await organization(owner, viewer)
    await attach(context, owner.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + personalPath)
    await expectUI(
      page.getByRole("heading", { name: "个人头像", exact: true })
    ).toBeVisible()
    // 两个后台菜单都用同一个身份事实，菜单入口保持真实路由导航。
    await page.getByRole("button", { name: /Platform operator/ }).click()
    await page.getByRole("menuitem", { name: "个人设置", exact: true }).click()
    await expectUI(page).toHaveURL(new RegExp(personalPath + "$"))
    let previous = null
    const platform = await context.newPage()
    await platform.goto(environment.platformOrigin + "/platform")
    await platform.getByRole("button", { name: /Platform operator/ }).click()
    await platform
      .getByRole("menuitem", { name: "个人设置", exact: true })
      .click()
    await expectUI(platform).toHaveURL(/\/platform\/personal-settings$/)
    const viewerContext = await environment.browser.newContext({
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    resources.defer(() => viewerContext.close())
    await attach(viewerContext, viewer.cookie, environment.tenantOrigin)
    const directory = await viewerContext.newPage()
    for (const [index, format] of ["png", "jpeg", "webp", "gif"].entries()) {
      const editor = index % 2 === 0 ? page : platform
      await editor.reload()
      expect(await current(owner)).toBe(previous)
      const { candidate, receipt } = await saveSelected(
        editor,
        format,
        images[format],
        async () => expect(await current(owner)).toBe(previous)
      )
      expect(receipt.image).toBe(candidate.media.contentUrl)
      expect(await current(owner)).toBe(candidate.media.contentUrl)
      previous = candidate.media.contentUrl
      await page.reload()
      await ownNav(page)
      await platform.reload()
      await ownNav(platform)
      const response = directory.waitForResponse(
        (r) =>
          r.request().method() == "GET" &&
          new URL(r.url()).pathname === canonical(candidate.media.id)
      )
      await directory.goto(environment.tenantOrigin + `/app/members/${org.id}`)
      await decoded(
        memberDirectory(directory).getByAltText("Platform operator", {
          exact: true,
        })
      )
      const read = await response
      expect(read.status()).toBe(200)
      expect(new URL(read.url()).searchParams.get("organizationId")).toBe(
        org.id
      )
      const visibleBytes = await memberDirectory(directory)
        .getByAltText("Platform operator", { exact: true })
        .evaluate(async (image) =>
          Array.from(
            new Uint8Array(await (await fetch(image.src)).arrayBuffer())
          )
        )
      expect(sha(Buffer.from(visibleBytes))).toBe(sha(images[format]))
      const own = await content(owner, candidate.media.id)
      expect(sha(Buffer.from(await own.arrayBuffer()))).toBe(
        sha(images[format])
      )
      expect((await content(viewer, candidate.media.id)).status).toBe(404)
      expect(
        (await content(viewer, candidate.media.id, randomUUID())).status
      ).toBe(404)
    }
    await page.screenshot({
      path: join(tmpdir(), `personal-avatar-${backend}-tenant.png`),
      fullPage: true,
    })
    await platform.screenshot({
      path: join(tmpdir(), `personal-avatar-${backend}-platform.png`),
      fullPage: true,
    })
    const removed = await save(platform, true)
    expect(removed.image).toBeNull()
    expect(await current(owner)).toBeNull()
    await page.reload()
    await platform.reload()
    await directory.reload()
    await expectUI(
      page.locator('[data-slot="sidebar-footer"] [data-personal-avatar] img')
    ).toHaveCount(0)
    await expectUI(
      platform.locator(
        '[data-slot="sidebar-footer"] [data-personal-avatar] img'
      )
    ).toHaveCount(0)
    const ownerRow = memberDirectory(directory)
      .getByRole("row")
      .filter({ hasText: owner.user.email })
    await expectUI(ownerRow).toBeVisible()
    await expectUI(
      ownerRow.getByAltText("Platform operator", { exact: true })
    ).toHaveCount(0)
  })

  it("一次保存依次上传并 CAS，冲突保留选择和预览，明确重试重新比较事实", async () => {
    const actor = await account()
    const initial = await outsideUpload(actor)
    await outsideSave(actor, initial.media.id, null)
    await attach(context, actor.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + personalPath)
    await ownNav(page)
    let release, entered, releaseSave, enteredSave
    const gate = new Promise((resolve) => {
        release = resolve
      }),
      waiting = new Promise((resolve) => {
        entered = resolve
      })
    const saveGate = new Promise((resolve) => {
        releaseSave = resolve
      }),
      saveWaiting = new Promise((resolve) => {
        enteredSave = resolve
      })
    await page.route("**/api/v1/personal-media", async (route) => {
      entered()
      await gate
      await route.continue()
    })
    await page.route("**/api/v1/personal-media/avatar", async (route) => {
      enteredSave()
      await saveGate
      await route.continue()
    })
    await choose(page, "webp")
    const uploadResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/v1/personal-media"
    )
    const saveResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        new URL(r.url()).pathname === "/api/v1/personal-media/avatar"
    )
    await page.getByRole("button", { name: "保存头像", exact: true }).click()
    await waiting
    try {
      await expectUI(
        page.getByRole("button", { name: "正在保存头像…", exact: true })
      ).toBeDisabled()
      await expectUI(page.getByLabel("选择头像图片")).toBeDisabled()
    } finally {
      release()
    }
    const upload = await uploadResponse
    expect(upload.status()).toBe(201)
    const candidate = await upload.json()
    await saveWaiting
    const concurrent = await outsideUpload(actor, "jpeg")
    await outsideSave(actor, concurrent.media.id, initial.media.contentUrl)
    releaseSave()
    const conflict = await saveResponse
    expect(conflict.status()).toBe(409)
    expect((await conflict.json()).code).toBe("VERSION_CONFLICT")
    await expectUI(page.getByRole("alert")).toContainText("头像保存失败")
    await expectUI(page.getByAltText("新头像预览")).toBeVisible()
    expect(await current(actor)).toBe(concurrent.media.contentUrl)
    const retry = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" &&
        new URL(r.url()).pathname === "/api/v1/personal-media/avatar"
    )
    await page.getByRole("button", { name: "保存头像", exact: true }).click()
    const retried = await retry
    expect(retried.status()).toBe(200)
    const receipt = await retried.json()
    expect(receipt.image).toBe(candidate.media.contentUrl)
    expect(await current(actor)).toBe(candidate.media.contentUrl)
  })

  it("拒绝过大与不支持格式，上传失败后保留图片并可重试", async () => {
    const actor = await account()
    await attach(context, actor.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + personalPath)
    const postRequests = []
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v1/personal-media"
      )
        postRequests.push(request)
    })

    await selectFile(page, "头像.svg", "image/svg+xml", Buffer.from("<svg/>"))
    await expectUI(page.getByRole("alert")).toContainText(
      "请选择可解码的 JPEG、PNG、WebP 或 GIF 图片。"
    )
    await selectFile(
      page,
      "头像.png",
      "image/png",
      Buffer.alloc(5 * 1024 * 1024 + 1)
    )
    await expectUI(page.getByRole("alert")).toContainText(
      "头像图片不能超过 5 MiB。"
    )
    expect(postRequests).toHaveLength(0)

    let failFirstUpload = true
    await page.route("**/api/v1/personal-media", async (route) => {
      if (failFirstUpload) {
        failFirstUpload = false
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "INTERNAL_ERROR",
            message: "上传暂时不可用",
            requestId: randomUUID(),
            locale: "zh-CN",
          }),
        })
      } else await route.continue()
    })
    await choose(page, "png")
    const failedUpload = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/personal-media"
    )
    await page.getByRole("button", { name: "保存头像", exact: true }).click()
    expect((await failedUpload).status()).toBe(503)
    await expectUI(page.getByRole("alert")).toContainText("头像保存失败")
    await expectUI(page.getByAltText("新头像预览")).toBeVisible()

    const uploadResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/v1/personal-media" &&
        response.status() === 201
    )
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === "/api/v1/personal-media/avatar"
    )
    await page.getByRole("button", { name: "保存头像", exact: true }).click()
    const upload = await uploadResponse
    const candidate = await upload.json()
    const saved = await saveResponse
    expect(saved.status()).toBe(200)
    expect((await saved.json()).image).toBe(candidate.media.contentUrl)
    expect(await current(actor)).toBe(candidate.media.contentUrl)
    const stored = await content(actor, candidate.media.id)
    expect(sha(Buffer.from(await stored.arrayBuffer()))).toBe(sha(images.png))
  })

  it("成员头像实时撤权隐藏，暂停组织不限制本人设置，撤销 Session 不能上传成功", async () => {
    const owner = await platformOperator(
      environment,
      environment.platformOrigin
    )
    const viewer = await account("受委派头像读者")
    const org = await organization(owner)
    const created = await environment.runtime.auth.api.createOrgRole({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        role: "avatar-reader",
        permission: { member: ["read"] },
      },
    })
    await environment.runtime.auth.api.addMember({
      headers: owner.headers,
      body: {
        organizationId: org.id,
        userId: viewer.user.id,
        role: "avatar-reader",
      },
    })
    const media = await outsideUpload(owner)
    await outsideSave(owner, media.media.id, null)
    await attach(context, viewer.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + `/app/members/${org.id}`)
    await decoded(
      memberDirectory(page).getByAltText("Platform operator", { exact: true })
    )
    const access = await fetch(
      environment.baseURL + `/api/v1/organizations/${org.id}/role-access`,
      { headers: owner.headers }
    )
    expect(access.status).toBe(200)
    const state = await environment.observer.query(
      "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
      [org.id]
    )
    const revoked = await fetch(
      environment.baseURL + "/api/auth/organization/update-role",
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          origin: environment.platformOrigin,
          "content-type": "application/json",
          "X-Expected-Authz-Version": String(
            state.rows[0].authorization_version
          ),
        },
        body: JSON.stringify({
          organizationId: org.id,
          roleId: created.roleData.id,
          data: { permission: { project: ["read"] } },
        }),
      }
    )
    expect(revoked.status, await revoked.clone().text()).toBe(200)
    await page.reload()
    await expectUI(
      page.getByRole("heading", { name: "无权访问", exact: true })
    ).toBeVisible()
    await expectUI(memberDirectory(page)).toHaveCount(0)
    expect((await content(viewer, media.media.id, org.id)).status).toBe(404)
    const suspended = await fetch(
      environment.baseURL + `/api/v1/platform/organizations/${org.id}/suspend`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          origin: environment.platformOrigin,
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          expectedVersion: 1,
          reason: "头像设置独立于组织暂停",
        }),
      }
    )
    expect(suspended.status, await suspended.clone().text()).toBe(200)
    const ownerContext = await environment.browser.newContext({
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    resources.defer(() => ownerContext.close())
    await attach(ownerContext, owner.cookie, environment.tenantOrigin)
    const personal = await ownerContext.newPage()
    await personal.goto(environment.tenantOrigin + personalPath)
    const { candidate, receipt } = await saveSelected(personal, "gif")
    expect(receipt.image).toBe(candidate.media.contentUrl)
    expect((await content(viewer, candidate.media.id, org.id)).status).toBe(404)
    const sessionActor = await account("被撤销会话头像用户")
    const persisted = await outsideUpload(sessionActor)
    await outsideSave(sessionActor, persisted.media.id, null)
    const sessionContext = await environment.browser.newContext({
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    resources.defer(() => sessionContext.close())
    await attach(sessionContext, sessionActor.cookie, environment.tenantOrigin)
    const sessionPage = await sessionContext.newPage()
    await sessionPage.goto(environment.tenantOrigin + personalPath)
    await ownNav(sessionPage)
    await choose(sessionPage)
    const response = sessionPage.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/v1/personal-media"
    )
    const sessionResponse = await fetch(
      environment.baseURL + "/api/auth/get-session",
      {
        headers: {
          cookie: sessionActor.cookie,
          origin: environment.tenantOrigin,
        },
      }
    )
    expect(sessionResponse.status).toBe(200)
    const activeSession = (await sessionResponse.json()).session
    const revokedSession = await fetch(
      environment.baseURL + "/api/auth/revoke-session",
      {
        method: "POST",
        headers: {
          cookie: sessionActor.cookie,
          origin: environment.tenantOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: activeSession.token }),
      }
    )
    expect(revokedSession.status).toBe(200)
    await sessionPage
      .getByRole("button", { name: "保存头像", exact: true })
      .click()
    expect((await response).status()).toBe(401)
    await expectUI(
      sessionPage.getByRole("heading", { name: "个人头像", exact: true })
    ).toHaveCount(0)
    await expectUI(sessionPage).toHaveURL(/\/login$/)
    expect(await current(sessionActor)).toBe(persisted.media.contentUrl)
    await sessionPage
      .getByLabel("邮箱", { exact: true })
      .fill(sessionActor.email)
    await sessionPage
      .getByLabel("密码", { exact: true })
      .fill(sessionActor.password)
    await sessionPage.getByRole("button", { name: "登录", exact: true }).click()
    await expectUI(sessionPage).toHaveURL(/\/app\/select-organization$/)
    await expectUI(
      sessionPage.getByRole("heading", { name: "创建组织", exact: true })
    ).toBeVisible()
    await sessionPage
      .getByRole("link", { name: "个人设置", exact: true })
      .click()
    await expectUI(sessionPage).toHaveURL(new RegExp(personalPath + "$"))
    await ownNav(sessionPage)
    const { candidate: resumed, receipt: resumedReceipt } = await saveSelected(
      sessionPage,
      "webp"
    )
    expect(resumedReceipt.image).toBe(resumed.media.contentUrl)
  })

  it("真实 CAS 已提交但响应丢失时不自动重试，明确重试复用完整请求和同一收据", async () => {
    const actor = await account("未知结果头像用户")
    await attach(context, actor.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + personalPath)
    await choose(page, "webp")
    const requests = []
    const uploadResponse = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === "/api/v1/personal-media"
    )
    let first = true,
      resolveCommitted
    const committed = new Promise((resolve) => {
      resolveCommitted = resolve
    })
    await page.route("**/api/v1/personal-media/avatar", async (route) => {
      requests.push(route.request().postDataJSON())
      if (first) {
        first = false
        // 先由真实生产路由提交，再断开浏览器响应；没有模拟成功收据。
        const response = await route.fetch()
        resolveCommitted({
          status: response.status(),
          receipt: await response.json(),
        })
        await route.abort("failed")
      } else await route.continue()
    })
    await page.getByRole("button", { name: "保存头像", exact: true }).click()
    const write = await committed
    const upload = await uploadResponse
    expect(upload.status()).toBe(201)
    const candidate = await upload.json()
    expect(write.status).toBe(200)
    await expectUI(page.getByRole("alert")).toContainText("未收到头像保存结果")
    await expectUI(page.getByAltText("新头像预览")).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(await current(actor)).toBe(candidate.media.contentUrl)
    const receipt = await save(page)
    expect(receipt).toEqual(write.receipt)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    await ownNav(page)
  })

  it("中文选图按钮支持键盘打开文件选择器，预览后才允许保存", async () => {
    const actor = await account("键盘头像用户")
    await attach(context, actor.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + personalPath)
    const chooseImage = page.getByRole("button", {
      name: "选择图片",
      exact: true,
    })
    await chooseImage.focus()
    await expectUI(chooseImage).toBeFocused()
    const chooser = page.waitForEvent("filechooser")
    await chooseImage.press("Enter")
    await (
      await chooser
    ).setFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: images.png,
    })
    await expectUI(page.getByAltText("新头像预览")).toBeVisible()
    await expectUI(page.getByText("保存后生效")).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "保存头像", exact: true })
    ).toBeEnabled()
    expect(await current(actor)).toBeNull()
  })

  it("三语言与 RTL 保持真实控件语义、键盘入口和无障碍", async () => {
    const actor = await account("头像语言用户")
    await attach(context, actor.cookie, environment.tenantOrigin)
    await page.goto(environment.tenantOrigin + personalPath)
    await expectUI(
      page.getByRole("heading", { name: "个人头像", exact: true })
    ).toBeVisible()
    await selectLocale(page, actor.user.name, "English")
    await expectUI(
      page.getByRole("heading", { name: "Personal avatar", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("html")).toHaveAttribute("lang", "en-US")
    await selectLocale(page, actor.user.name, "العربية", "Language")
    await expectUI(
      page.getByRole("heading", { name: "الصورة الشخصية", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    await page.setViewportSize({ width: 375, height: 844 })
    await page.getByLabel("اختيار صورة شخصية").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: images.png,
    })
    await expectUI(
      page.getByAltText("معاينة الصورة الشخصية الجديدة")
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "حفظ الصورة الشخصية", exact: true })
    ).toBeEnabled()
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    ).toBe(true)
    await page.screenshot({
      path: join(tmpdir(), `personal-avatar-${backend}-mobile-rtl.png`),
      fullPage: true,
    })
    await page.addScriptTag({
      path: a11yRequire.resolve("axe-core/axe.min.js"),
    })
    const violations = await page.evaluate(async () =>
      (
        await window.axe.run(document.querySelector("main"), {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
      ).violations.map(({ id, nodes }) => ({
        id,
        nodes: nodes.map((node) => node.target),
      }))
    )
    expect(violations).toEqual([])
    await page.setViewportSize({ width: 1280, height: 900 })
    await selectLocale(page, actor.user.name, "简体中文", "اللغة")
    await expectUI(
      page.getByRole("heading", { name: "个人头像", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "ltr")
  })
})
