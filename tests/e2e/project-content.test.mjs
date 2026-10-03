import { createHash, randomBytes, randomUUID } from "node:crypto"
import { deflateSync } from "node:zlib"
import { readFile } from "node:fs/promises"
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
import { startPersonalAvatarBrowser } from "../setup/personal-avatar-runtime.mjs"

const sha = (body) => createHash("sha256").update(body).digest("hex")
const storybookRequire = createRequire(resolve("apps/storybook/package.json"))
const a11yRequire = createRequire(
  storybookRequire.resolve("@storybook/addon-a11y")
)
function png(red, green, blue) {
  const crc = (bytes) => {
    let value = 0xffffffff
    for (const byte of bytes) {
      value ^= byte
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (name, bytes) => {
    const data = Buffer.concat([Buffer.from(name), bytes])
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4)
    length.writeUInt32BE(bytes.length)
    checksum.writeUInt32BE(crc(data))
    return Buffer.concat([length, data, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, red, green, blue]))),
    chunk("IEND", Buffer.alloc(0)),
  ])
}
const original = png(255, 0, 0)
const replacement = png(0, 0, 255)
const document = (text, nodes = []) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }, ...nodes],
})
const reference = (result) => ({
  fileId: result.entryId,
  versionId: result.versionId,
})
const fileNodes = (body) => {
  const nodes = []
  const visit = (node) => {
    if (node.type === "fileImage" || node.type === "fileAttachment")
      nodes.push(node)
    node.content?.forEach(visit)
  }
  visit(body)
  return nodes
}

for (const backend of ["Local", "RustFS"])
  describe(`Projects 富文本正式消费者 / ${backend}`, () => {
    const resources = new AsyncDisposableStack()
    let environment, context, page
    beforeAll(async () => {
      try {
        environment = await startPersonalAvatarBrowser(backend, resources)
      } catch (error) {
        await resources.disposeAsync()
        throw error
      }
    })
    afterAll(() => resources.disposeAsync())
    beforeEach(async () => {
      context = await environment.browser.newContext({
        viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: {
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
      })
      page = await context.newPage()
    })
    afterEach(async (testContext) => {
      if (testContext.task.result?.state === "fail")
        await page.screenshot({
          path: join(tmpdir(), `project-content-${backend}-failure.png`),
          fullPage: true,
        })
      await context.close()
    })
    const json = (method, input) => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    function request(f, path, options = {}, actor = f.owner) {
      return fetch(
        environment.baseURL +
          `/api/v1/organizations/${f.organization.id}${path}`,
        {
          ...options,
          headers: { ...Object.fromEntries(actor.headers), ...options.headers },
        }
      )
    }
    async function fixture() {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "富文本验收用户" }
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "正文验收组织", slug: randomUUID() },
        })
      const f = { owner, organization }
      const workspace = await request(f, "/files/workspace")
      expect(workspace.status, await workspace.clone().text()).toBe(200)
      f.root = (await workspace.json()).root
      const folderResponse = await request(
        f,
        "/files/folders",
        json("POST", {
          operationId: randomUUID(),
          parentId: f.root.id,
          name: "正文图片",
        })
      )
      expect(folderResponse.status, await folderResponse.clone().text()).toBe(
        200
      )
      f.folderId = (await folderResponse.json()).result.entryId
      const projectResponse = await request(
        f,
        "/projects",
        json("POST", {
          name: "正式富文本项目",
          description: "<b>纯文本摘要仍保留</b>",
          contentLocale: "zh-CN",
        })
      )
      expect(projectResponse.status, await projectResponse.clone().text()).toBe(
        201
      )
      f.project = await projectResponse.json()
      return f
    }
    const path = (f) =>
      environment.tenantOrigin +
      `/app/projects/${f.organization.id}/${f.project.id}`
    function card(target = page, title = "富文本正文") {
      return target
        .locator('[data-slot="card"]')
        .filter({ has: target.getByText(title, { exact: true }) })
    }
    const editor = (target = page) =>
      card(target).locator(".tiptap[contenteditable=true]")
    async function signIn(actor, f) {
      await page.goto(environment.tenantOrigin + "/app/")
      await page.getByLabel("邮箱", { exact: true }).fill(actor.email)
      await page.getByLabel("密码", { exact: true }).fill(actor.password)
      await page.getByRole("button", { name: "登录", exact: true }).click()
      await expectUI(
        page
          .getByRole("navigation", { name: "主导航", exact: true })
          .getByRole("link", { name: "项目", exact: true })
      ).toBeVisible()
      await page.goto(path(f))
      await expectUI(card()).toBeVisible()
    }
    async function read(f, locale = "zh-CN", actor) {
      const response = await request(
        f,
        `/projects/${f.project.id}/content/${locale}`,
        {},
        actor
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    async function write(f, body, expectedRevision = null, locale = "zh-CN") {
      const response = await request(
        f,
        `/projects/${f.project.id}/content/${locale}`,
        json("PUT", { expectedRevision, document: body })
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    async function save(f, target = page, locale = "zh-CN", status = 200) {
      const pending = target.waitForResponse(
        (r) =>
          r.request().method() === "PUT" &&
          new URL(r.url()).pathname.endsWith(
            `/projects/${f.project.id}/content/${locale}`
          )
      )
      await card(target)
        .getByRole("button", { name: "保存正文", exact: true })
        .click()
      const response = await pending
      expect(response.status(), await response.text()).toBe(status)
      return response.json()
    }
    async function chooseUploadFolder() {
      await card()
        .getByRole("button", { name: "图片上传文件夹", exact: true })
        .click()
      const dialog = page.getByRole("dialog", {
        name: "选择目标文件夹",
        exact: true,
      })
      await dialog
        .getByRole("button", { name: "正文图片", exact: true })
        .click()
      await expectUI(
        dialog.getByRole("button", { name: "使用此文件夹", exact: true })
      ).toBeEnabled()
      await dialog
        .getByRole("button", { name: "使用此文件夹", exact: true })
        .click()
      await expectUI(dialog).not.toBeVisible()
    }
    async function uploadFromEditor(method, name, bytes = original) {
      const result = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/files/uploads")
      )
      if (method === "toolbar") {
        await card().getByRole("button", { name: "图片", exact: true }).click()
        await card()
          .locator('input[type="file"]')
          .setInputFiles({ name, mimeType: "image/png", buffer: bytes })
      } else {
        await editor().evaluate(
          (element, { method, name, bytes }) => {
            element.focus()
            const data = new DataTransfer()
            data.items.add(
              new File([new Uint8Array(bytes)], name, { type: "image/png" })
            )
            if (method === "paste")
              element.dispatchEvent(
                new ClipboardEvent("paste", {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: data,
                })
              )
            else {
              const rect = element.getBoundingClientRect()
              element.dispatchEvent(
                new DragEvent("drop", {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: data,
                  clientX: rect.x + 20,
                  clientY: rect.y + 20,
                })
              )
            }
          },
          { method, name, bytes: [...bytes] }
        )
      }
      const response = await result
      expect(response.status(), await response.text()).toBe(200)
      const receipt = await response.json()
      expect(receipt.phase).toBe("completed")
      await expectUI(
        card().getByRole("img", { name, exact: true })
      ).toBeVisible()
      return receipt.result
    }
    async function rawUpload(f, name, bytes = original) {
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        parentId: f.folderId,
        name,
        contentSha256: sha(bytes),
        declaredBytes: bytes.length,
      }))
        form.append(key, String(value))
      form.append("file", new File([bytes], name, { type: "image/png" }))
      const response = await request(f, "/files/uploads", {
        method: "POST",
        body: form,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).result
    }
    async function refs(f) {
      return (
        await environment.observer.query(
          "SELECT file_id, version_id, locale FROM public.file_references WHERE organization_id=$1 AND project_id=$2 AND kind='project_rich_text' ORDER BY position",
          [f.organization.id, f.project.id]
        )
      ).rows
    }
    async function chooseExisting(action, name) {
      await card().getByRole("button", { name: action, exact: true }).click()
      const picker = page.getByRole("dialog", { name: "选择文件", exact: true })
      await picker
        .getByRole("button", { name: "正文图片", exact: true })
        .click()
      await picker.getByRole("button", { name, exact: true }).click()
      await picker
        .getByRole("button", { name: "使用文件", exact: true })
        .click()
      await expectUI(picker).not.toBeVisible()
    }
    async function contentBytes(f, result, actor) {
      const response = await request(
        f,
        `/files/entries/${result.entryId}/versions/${result.versionId}/content`,
        {},
        actor
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return Buffer.from(await response.arrayBuffer())
    }
    async function role(f, permission) {
      const actor = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "富文本委派用户" }
      )
      const roleName = "content-" + randomUUID()
      const created = await environment.runtime.auth.api.createOrgRole({
        headers: f.owner.headers,
        body: { organizationId: f.organization.id, role: roleName, permission },
      })
      await environment.runtime.auth.api.addMember({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          userId: actor.user.id,
          role: roleName,
        },
      })
      return { actor, id: created.roleData.id }
    }
    async function changeRole(f, granted, permission) {
      const access = await request(f, "/access")
      const response = await fetch(
        environment.baseURL + "/api/auth/organization/update-role",
        {
          ...json("POST", {
            organizationId: f.organization.id,
            roleId: granted.id,
            data: { permission },
          }),
          headers: {
            ...Object.fromEntries(f.owner.headers),
            "content-type": "application/json",
            "X-Expected-Authz-Version": String(
              (await access.json()).authorizationVersion
            ),
          },
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
    }

    it("工具栏、粘贴与拖放真实上传到明确文件夹，保存刷新后正文与三条固定版本引用同事务一致", async () => {
      const f = await fixture()
      await signIn(f.owner, f)
      await editor().fill("已编辑正文，保留原摘要。")
      await card()
        .getByRole("button", { name: "插入表格", exact: true })
        .click()
      for (const [index, cell] of (
        await editor().locator("th p").all()
      ).entries())
        await cell.fill(`标题 ${index + 1}`)
      await chooseUploadFolder()
      const uploaded = []
      for (const method of ["toolbar", "paste", "drop"])
        uploaded.push(await uploadFromEditor(method, `正文-${method}.png`))
      const saved = await save(f)
      expect(saved.revision).toBe(1)
      expect(
        fileNodes(saved.document)
          .map((node) => node.attrs.versionId)
          .sort()
      ).toEqual(uploaded.map((result) => result.versionId).sort())
      expect(JSON.stringify(saved.document)).not.toMatch(
        /blob:|data:|"src"|"href"/
      )
      expect(saved.document.content.some((node) => node.type === "table")).toBe(
        true
      )
      expect((await refs(f)).map((row) => row.version_id).sort()).toEqual(
        uploaded.map((result) => result.versionId).sort()
      )
      for (const result of uploaded) {
        expect(await contentBytes(f, result)).toEqual(original)
        const file = await request(f, `/files/entries/${result.entryId}`)
        expect((await file.json()).parentId).toBe(f.folderId)
      }
      await page.reload()
      await expectUI(editor()).toContainText("已编辑正文")
      await expectUI(card().getByRole("img")).toHaveCount(3)
      await expectUI(
        page.getByText("<b>纯文本摘要仍保留</b>", { exact: true })
      ).toBeVisible()
      await page.screenshot({
        path: join(tmpdir(), `project-content-${backend}-uploads.png`),
        fullPage: true,
      })
    }, 120000)

    it("已有图片和文件链接持有固定旧版本，库覆盖不改引用；显式历史版本选择和解除引用不删除文件", async () => {
      const f = await fixture()
      const uploaded = await rawUpload(f, "fixed-image.png")
      await signIn(f.owner, f)
      await chooseExisting("在正文末尾插入已有图片", "fixed-image.png")
      await chooseExisting("在正文末尾插入文件链接", "fixed-image.png")
      await save(f)
      const overwrite = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        expectedRevision: 1,
        declaredBytes: replacement.length,
        contentSha256: sha(replacement),
      }))
        overwrite.append(key, String(value))
      overwrite.append(
        "file",
        new File([replacement], "new.png", { type: "image/png" })
      )
      const changed = await request(
        f,
        `/files/entries/${uploaded.entryId}/overwrite`,
        { method: "POST", body: overwrite }
      )
      expect(changed.status, await changed.clone().text()).toBe(200)
      const next = (await changed.json()).result
      expect(next.versionId).not.toBe(uploaded.versionId)
      await page.reload()
      const stored = await read(f)
      expect(
        fileNodes(stored.document).every(
          (node) => node.attrs.versionId === uploaded.versionId
        )
      ).toBe(true)
      expect(await contentBytes(f, uploaded)).toEqual(original)
      const download = page.waitForEvent("download")
      await card()
        .getByRole("button", { name: "下载 fixed-image.png", exact: true })
        .click()
      const downloaded = await download
      expect(downloaded.suggestedFilename()).toBe("fixed-image.png")
      expect(await readFile(await downloaded.path())).toEqual(original)
      const trash = await request(
        f,
        `/files/entries/${uploaded.entryId}/trash`,
        json("POST", {
          operationId: randomUUID(),
          expectedRevision: next.revision,
        })
      )
      expect(trash.status).toBe(409)
      expect((await trash.json()).code).toBe("FILE_REFERENCED")
      await card()
        .getByRole("button", { name: "选择文件版本", exact: true })
        .first()
        .click()
      const versions = page.getByRole("dialog", {
        name: "选择文件版本",
        exact: true,
      })
      await expectUI(
        versions.getByRole("button", { name: "保存", exact: true })
      ).toBeEnabled()
      await versions
        .getByRole("combobox", { name: "文件版本", exact: true })
        .click()
      await page
        .getByRole("option", { name: next.versionId, exact: true })
        .click()
      await versions.getByRole("button", { name: "保存", exact: true }).click()
      const saved = await save(f)
      expect(
        fileNodes(saved.document).find((node) => node.type === "fileImage")
          .attrs.versionId
      ).toBe(next.versionId)
      expect(
        fileNodes(saved.document).find((node) => node.type === "fileAttachment")
          .attrs.versionId
      ).toBe(uploaded.versionId)
      await card()
        .getByRole("button", { name: "从正文解除引用", exact: true })
        .first()
        .click()
      await card()
        .getByRole("button", { name: "从正文解除引用", exact: true })
        .first()
        .click()
      await save(f)
      expect(await refs(f)).toEqual([])
      expect(
        (await request(f, `/files/entries/${uploaded.entryId}`)).status
      ).toBe(200)
      expect(await contentBytes(f, next)).toEqual(replacement)
    }, 120000)

    it("双页面CAS冲突保留草稿，语言草稿与UI语言独立，显式重载和键盘三语RTL保存一致", async () => {
      const f = await fixture()
      await write(f, document("初始正文"))
      await signIn(f.owner, f)
      const concurrent = await context.newPage()
      await concurrent.goto(path(f))
      await expectUI(editor(concurrent)).toBeVisible()
      await editor().fill("首先提交的正文")
      await editor(concurrent).fill("冲突但保留的正文")
      await save(f)
      await save(f, concurrent, "zh-CN", 409)
      await expectUI(editor(concurrent)).toContainText("冲突但保留的正文")
      await concurrent.close()
      await editor().fill("中文内存草稿")
      const language = card().getByRole("combobox", {
        name: "内容语言",
        exact: true,
      })
      await language.focus()
      await language.press("Enter")
      await page.getByRole("option", { name: "العربية", exact: true }).click()
      await editor().fill("مسودة عربية")
      await expectUI(
        card().getByRole("group", { name: "正文", exact: true })
      ).toHaveAttribute("dir", "rtl")
      await language.click()
      await page.getByRole("option", { name: "简体中文", exact: true }).click()
      await expectUI(editor()).toContainText("中文内存草稿")
      await card()
        .getByRole("button", { name: "放弃该语言草稿并重新载入", exact: true })
        .click()
      await expectUI(editor()).toContainText("首先提交的正文")
      await language.click()
      await page.getByRole("option", { name: "العربية", exact: true }).click()
      await expectUI(editor()).toContainText("مسودة عربية")
      await save(f, page, "ar")
      expect((await read(f, "ar")).revision).toBe(1)
      expect(JSON.stringify((await read(f, "zh-CN")).document)).toContain(
        "首先提交的正文"
      )
      for (const [current, next, title] of [
        ["语言", "English", "Rich text content"],
        ["Language", "العربية", "المحتوى المنسق"],
      ]) {
        await page.getByRole("button", { name: /富文本验收用户/ }).click()
        const menu = page.getByRole("menuitem", { name: current, exact: true })
        await menu.focus()
        const direction = await page.locator("html").getAttribute("dir")
        await menu.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight")
        const option = page.getByRole("menuitemradio", {
          name: next,
          exact: true,
        })
        await expectUI(option).toBeVisible()
        await option.focus()
        await option.press("Enter")
        // 旧菜单退出时会归还焦点，下一次选择必须等待它完成卸载。
        await expectUI(
          page.getByRole("menu", { includeHidden: true })
        ).toHaveCount(0)
        await expectUI(page.getByText(title, { exact: true })).toBeVisible()
      }
      await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
      // Base UI keeps its focus guards during the menu exit animation; audit the
      // settled page after that native keyboard interaction has finished.
      await expectUI(page.locator("[data-base-ui-focus-guard]")).toHaveCount(0)
      await page.addScriptTag({
        path: a11yRequire.resolve("axe-core/axe.min.js"),
      })
      const result = await page.evaluate(() =>
        axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })
      )
      expect(
        result.violations.map(({ id, nodes }) => ({
          id,
          targets: nodes.map(({ target }) => target),
        }))
      ).toEqual([])
      await page.screenshot({
        path: join(tmpdir(), `project-content-${backend}-rtl.png`),
        fullPage: true,
      })
    }, 120000)

    it("project读者能读正文而不能读字节；translate可保存正文，撤file读权限后保存403保留草稿，刷新清除临时URL", async () => {
      const f = await fixture()
      const uploaded = await rawUpload(f, "权限图片.png")
      await write(
        f,
        document("业务可读正文", [
          {
            type: "fileImage",
            attrs: { ...reference(uploaded), alt: "权限图片" },
          },
        ])
      )
      const reader = await role(f, { project: ["read"] })
      await signIn(reader.actor, f)
      await expectUI(card().locator(".tiptap")).toContainText("业务可读正文")
      await expectUI(card().getByRole("img")).toHaveCount(0)
      await expectUI(
        card().getByRole("button", { name: "保存正文", exact: true })
      ).toHaveCount(0)
      expect(
        (
          await request(
            f,
            `/files/entries/${uploaded.entryId}/versions/${uploaded.versionId}/content`,
            {},
            reader.actor
          )
        ).status
      ).toBe(403)
      await context.clearCookies()
      const translator = await role(f, {
        project: ["read", "translate"],
        file: ["read"],
        folder: ["read"],
      })
      await signIn(translator.actor, f)
      const image = card().getByRole("img", { name: "权限图片", exact: true })
      await expectUI(image).toBeVisible()
      await editor().locator("p").first().fill("译者保存的正文")
      await save(f)
      await expectUI(image).toBeVisible()
      const oldUrl = await image.getAttribute("src")
      expect(oldUrl).toMatch(/^blob:/)
      expect(
        await page.evaluate(async (url) => (await fetch(url)).ok, oldUrl)
      ).toBe(true)
      await editor().locator("p").first().fill("撤权但保留的草稿")
      await changeRole(f, translator, {
        project: ["read", "translate"],
        folder: ["read"],
      })
      await save(f, page, "zh-CN", 403)
      await expectUI(editor()).toContainText("撤权但保留的草稿")
      expect(JSON.stringify((await read(f)).document)).toContain(
        "译者保存的正文"
      )
      await page.reload()
      await expectUI(card().getByRole("img")).toHaveCount(0)
      expect(
        await page.evaluate(async (url) => {
          try {
            await fetch(url)
            return false
          } catch {
            return true
          }
        }, oldUrl)
      ).toBe(true)
    }, 120000)
  })
