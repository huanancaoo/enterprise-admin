import { createHash, randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
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
const original = Buffer.from("固定旧版本内容\n")
const replacement = Buffer.from("新的显式替换版本\n")
const reference = (result) => ({
  fileId: result.entryId,
  versionId: result.versionId,
})

for (const backend of ["Local", "RustFS"])
  describe(`Projects 附件真实消费者 / ${backend}`, () => {
    const resources = new AsyncDisposableStack()
    let environment, context, page, permissionStatuses, permissionRequests
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
        viewport: { width: 1280, height: 900 },
        extraHTTPHeaders: {
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
      })
      permissionStatuses = []
      permissionRequests = []
      context.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname ===
            "/api/auth/organization/has-permission"
        )
          permissionRequests.push(request.postDataJSON().permissions)
      })
      context.on("response", (response) => {
        if (
          new URL(response.url()).pathname ===
          "/api/auth/organization/has-permission"
        )
          permissionStatuses.push(response.status())
      })
      page = await context.newPage()
    })
    afterEach(async (testContext) => {
      if (testContext.task.result?.state === "fail") {
        console.info("Native permission response statuses", permissionStatuses)
        console.info(
          "Menu state",
          await page.evaluate(() =>
            [...document.querySelectorAll('[role="menu"]')].map((element) => ({
              attributes: Object.fromEntries(
                [...element.attributes].map(({ name, value }) => [name, value])
              ),
              hiddenAncestor: element.closest('[aria-hidden="true"]')?.tagName,
              focused: element.contains(document.activeElement),
            }))
          )
        )
        await page.screenshot({
          path: `/private/tmp/project-attachments-${backend}-failure.png`,
          fullPage: true,
        })
      }
      await context.close()
    })
    const filePermissionRequestCount = () =>
      permissionRequests.filter((permissions) =>
        Object.keys(permissions).some((resource) =>
          ["file", "folder"].includes(resource)
        )
      ).length
    const projectEditPermissionRequestCount = () =>
      permissionRequests.filter((permissions) =>
        permissions.project?.some((action) =>
          ["update", "translate"].includes(action)
        )
      ).length
    async function fixture() {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "项目附件验收用户" }
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "附件验收组织", slug: randomUUID() },
        })
      const f = { owner, organization }
      const response = await request(f, "/files/workspace")
      expect(response.status, await response.clone().text()).toBe(200)
      return { ...f, root: (await response.json()).root }
    }
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
    const json = (method, input) => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    })
    async function signIn(actor, org) {
      await page.goto(environment.tenantOrigin + "/app/")
      await page.getByLabel("邮箱", { exact: true }).fill(actor.email)
      await page.getByLabel("密码", { exact: true }).fill(actor.password)
      await page.getByRole("button", { name: "登录", exact: true }).click()
      const projects = page
        .getByRole("navigation", { name: "主导航", exact: true })
        .getByRole("link", { name: "项目", exact: true })
      await expectUI(projects).toBeVisible()
      expect(
        new URL(await projects.getAttribute("href"), environment.tenantOrigin)
          .pathname
      ).toBe(`/app/projects/${org.id}`)
    }
    const projectPath = (f, id) =>
      `/app/projects/${f.organization.id}${id ? "/" + id : ""}`
    async function addInPicker(name = "项目原稿.txt", body = original) {
      await page.getByRole("button", { name: "添加附件", exact: true }).click()
      const picker = page.getByRole("dialog", { name: "选择文件", exact: true })
      await expectUI(picker).toBeVisible()
      await picker
        .getByRole("button", { name: "上传文件", exact: true })
        .click()
      const upload = page.getByRole("dialog", { name: "上传文件", exact: true })
      await upload
        .getByLabel("选择文件", { exact: true })
        .setInputFiles({ name, mimeType: "text/plain", buffer: body })
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/files/uploads")
      )
      await upload
        .getByRole("button", { name: "开始上传", exact: true })
        .click()
      const completed = await response
      expect(completed.status(), await completed.text()).toBe(200)
      const receipt = await completed.json()
      expect(receipt.phase).toBe("completed")
      await expectUI(
        picker.getByRole("button", { name, exact: true })
      ).toBeVisible()
      await picker.getByRole("button", { name, exact: true }).click()
      await picker
        .getByRole("button", { name: "使用文件", exact: true })
        .click()
      await expectUI(picker).not.toBeVisible()
      return receipt.result
    }
    async function chooseExisting(name, replace = false) {
      await page
        .getByRole("button", {
          name: replace ? "替换版本" : "添加附件",
          exact: true,
        })
        .click()
      const picker = page.getByRole("dialog", { name: "选择文件", exact: true })
      await picker.getByRole("button", { name, exact: true }).click()
      await picker
        .getByRole("button", { name: "使用文件", exact: true })
        .click()
      await expectUI(picker).not.toBeVisible()
    }
    async function createFromUI(f, name = "附件项目") {
      await page.goto(environment.tenantOrigin + projectPath(f))
      await page.getByRole("button", { name: "创建项目", exact: true }).click()
      await page.getByLabel("项目名称", { exact: true }).fill(name)
      await page.getByLabel("描述", { exact: true }).fill("<b>纯文本概要</b>")
      const creates = []
      const capture = (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname.endsWith("/projects")
        )
          creates.push(request)
      }
      page.on("request", capture)
      const result = await addInPicker()
      expect(creates).toHaveLength(0)
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/projects")
      )
      await page
        .getByRole("dialog", { name: "创建项目", exact: true })
        .getByRole("button", { name: "创建项目", exact: true })
        .click()
      const created = await response
      expect(created.status(), await created.text()).toBe(201)
      const input = created.request().postDataJSON()
      expect(input.attachments).toEqual([reference(result)])
      expect(input.description).toBe("<b>纯文本概要</b>")
      expect(creates).toHaveLength(1)
      page.off("request", capture)
      return { project: await created.json(), result }
    }
    async function previewBytes(expected) {
      await page.getByRole("button", { name: "预览", exact: true }).click()
      const sheet = page.getByRole("dialog")
      await expectUI(
        sheet.getByRole("region", { name: "文本内容", exact: true })
      ).toHaveText(expected.toString().trim())
      const download = page.waitForEvent("download")
      await sheet.getByRole("button", { name: "下载文件", exact: true }).click()
      const downloaded = await download
      expect(await readFile(await downloaded.path())).toEqual(expected)
      await sheet.getByRole("button", { name: "关闭", exact: true }).click()
      await expectUI(
        page.getByRole("button", { name: "预览", exact: true })
      ).toBeFocused()
    }
    async function editSave(f, id, status = 200) {
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "PATCH" &&
          new URL(r.url()).pathname.endsWith(`/projects/${id}`)
      )
      await page
        .getByRole("dialog", { name: "编辑项目", exact: true })
        .getByRole("button", { name: "保存项目", exact: true })
        .click()
      const saved = await response
      expect(saved.status(), await saved.text()).toBe(status)
      return saved
    }
    async function attachments(f, id, actor) {
      const response = await request(
        f,
        `/projects/${id}/attachments`,
        {},
        actor
      )
      expect(response.status).toBe(200)
      return response.json()
    }
    async function rawUpload(f, name, bytes = original) {
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        parentId: f.root.id,
        name,
        contentSha256: sha(bytes),
        declaredBytes: bytes.length,
      }))
        form.append(key, String(value))
      form.append("file", new File([bytes], name, { type: "text/plain" }))
      const response = await request(f, "/files/uploads", {
        method: "POST",
        body: form,
      })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).result
    }
    async function role(f, permission) {
      const actor = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "项目委派用户" }
      )
      const roleName = "attachment-" + randomUUID()
      const created = await environment.runtime.auth.api.createOrgRole({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          role: roleName,
          permission,
        },
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

    it("真实选择器上传、创建与刷新，文件库覆盖仍读旧版本，显式替换和移除只改引用，取消草稿保留文件", async () => {
      const f = await fixture()
      await signIn(f.owner, f.organization)
      const created = await createFromUI(f)
      await page.goto(
        environment.tenantOrigin + projectPath(f, created.project.id)
      )
      await page.reload()
      await expectUI(
        page.getByText("<b>纯文本概要</b>", { exact: true })
      ).toBeVisible()
      expect(
        (await attachments(f, created.project.id)).items[0].versionId
      ).toBe(created.result.versionId)
      await previewBytes(original)
      const library = await context.newPage()
      await library.goto(
        environment.tenantOrigin +
          `/app/files/${f.organization.id}?parentId=${f.root.id}`
      )
      await library
        .locator("tbody tr")
        .filter({
          has: library.getByRole("button", {
            name: "项目原稿.txt",
            exact: true,
          }),
        })
        .getByRole("checkbox")
        .check()
      await library
        .getByRole("button", { name: "覆盖文件", exact: true })
        .click()
      const overwrite = library.getByRole("dialog", {
        name: "覆盖文件",
        exact: true,
      })
      await overwrite.getByLabel("选择文件", { exact: true }).setInputFiles({
        name: "替换.txt",
        mimeType: "text/plain",
        buffer: replacement,
      })
      const response = library.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/overwrite")
      )
      await overwrite
        .getByRole("button", { name: "确认覆盖", exact: true })
        .click()
      const changed = await response
      expect(changed.status(), await changed.text()).toBe(200)
      const next = (await changed.json()).result
      expect(next.versionId).not.toBe(created.result.versionId)
      await library.close()
      const beforeReloadProjectChecks = projectEditPermissionRequestCount()
      await page.reload()
      await previewBytes(original)
      await expectUI
        .poll(
          () => projectEditPermissionRequestCount() - beforeReloadProjectChecks
        )
        .toBe(2)
      const sameVersionChecks = filePermissionRequestCount()
      const sameVersionProjectChecks = projectEditPermissionRequestCount()
      await page.getByRole("button", { name: "编辑项目", exact: true }).click()
      await expectUI(
        page.getByRole("button", { name: "添加附件", exact: true })
      ).toBeEnabled()
      expect(filePermissionRequestCount()).toBe(sameVersionChecks)
      expect(projectEditPermissionRequestCount()).toBe(sameVersionProjectChecks)
      await chooseExisting("项目原稿.txt", true)
      await editSave(f, created.project.id)
      await expectUI(
        page.getByRole("dialog", { name: "编辑项目", exact: true })
      ).not.toBeVisible()
      expect(
        (await attachments(f, created.project.id)).items[0].versionId
      ).toBe(next.versionId)
      await previewBytes(replacement)
      await page.getByRole("button", { name: "编辑项目", exact: true }).click()
      await page.getByRole("button", { name: "移除引用", exact: true }).click()
      await editSave(f, created.project.id)
      expect((await attachments(f, created.project.id)).items).toEqual([])
      expect(
        (await request(f, `/files/entries/${created.result.entryId}`)).status
      ).toBe(200)
      await page.goto(environment.tenantOrigin + projectPath(f))
      await page.getByRole("button", { name: "创建项目", exact: true }).click()
      await page.getByLabel("项目名称", { exact: true }).fill("取消附件草稿")
      const kept = await addInPicker("取消后保留.txt")
      await page
        .getByRole("dialog", { name: "创建项目", exact: true })
        .getByRole("button", { name: "取消", exact: true })
        .click()
      expect((await request(f, `/files/entries/${kept.entryId}`)).status).toBe(
        200
      )
      const projects = await request(
        f,
        "/projects?name=" + encodeURIComponent("取消附件草稿")
      )
      expect((await projects.json()).items).toEqual([])
    }, 120000)

    it("并发附件 CAS 冲突保留双草稿、显式刷新后提交；仅改附件不覆盖同时保存的纯文本和状态", async () => {
      const f = await fixture()
      const uploaded = await rawUpload(f, "并发.txt")
      const created = await request(
        f,
        "/projects",
        json("POST", {
          name: "并发项目",
          description: "原概要",
          attachments: [reference(uploaded)],
        })
      )
      const project = await created.json()
      await signIn(f.owner, f.organization)
      await page.goto(environment.tenantOrigin + projectPath(f, project.id))
      await page.getByRole("button", { name: "编辑项目", exact: true }).click()
      await page.getByLabel("描述", { exact: true }).fill("保留的文字草稿")
      await page.getByRole("button", { name: "移除引用", exact: true }).click()
      const competing = await request(
        f,
        `/projects/${project.id}`,
        json("PATCH", {
          attachments: {
            expectedRevision: 1,
            items: [reference(uploaded), reference(uploaded)],
          },
        })
      )
      expect(competing.status).toBe(200)
      await editSave(f, project.id, 409)
      await expectUI(page.getByRole("alert")).toContainText(
        "附件已被其他人修改"
      )
      await expectUI(page.getByLabel("描述", { exact: true })).toHaveValue(
        "保留的文字草稿"
      )
      await expectUI(page.getByText("暂无附件", { exact: true })).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "保存项目", exact: true })
      ).toBeDisabled()
      await page
        .getByRole("button", { name: "刷新附件修订并保留草稿", exact: true })
        .click()
      const saved = await editSave(f, project.id)
      expect(saved.request().postDataJSON().attachments).toEqual({
        expectedRevision: 2,
        items: [],
      })
      await expectUI(
        page.getByRole("dialog", { name: "编辑项目", exact: true })
      ).not.toBeVisible()
      await expectUI(
        page.locator("dd").filter({ hasText: "保留的文字草稿" })
      ).toBeVisible()
      await page.getByRole("button", { name: "编辑项目", exact: true }).click()
      await chooseExisting("并发.txt")
      const other = await request(
        f,
        `/projects/${project.id}`,
        json("PATCH", {
          status: "active",
          translation: {
            locale: "zh-CN",
            name: "另一会话名称",
            description: "另一会话概要",
          },
        })
      )
      expect(other.status).toBe(200)
      const attachmentOnly = await editSave(f, project.id)
      expect(Object.keys(attachmentOnly.request().postDataJSON())).toEqual([
        "attachments",
      ])
      const final = await request(f, `/projects/${project.id}`)
      expect(await final.json()).toMatchObject({
        name: "另一会话名称",
        description: "另一会话概要",
        status: "active",
      })
    })

    it("项目读权与文件读权分离、翻译者只读附件，实时撤销编辑权限返回403并保留草稿", async () => {
      const f = await fixture()
      const uploaded = await rawUpload(f, "权限.txt")
      const created = await request(
        f,
        "/projects",
        json("POST", {
          name: "权限项目",
          description: "摘要",
          attachments: [reference(uploaded)],
        })
      )
      const project = await created.json()
      const reader = await role(f, { project: ["read"] })
      await signIn(reader.actor, f.organization)
      await page.goto(environment.tenantOrigin + projectPath(f, project.id))
      await expectUI(page.getByText("权限.txt", { exact: true })).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "预览", exact: true })
      ).toBeDisabled()
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
      await signIn(translator.actor, f.organization)
      await page.goto(environment.tenantOrigin + projectPath(f, project.id))
      await page.getByRole("button", { name: "编辑项目", exact: true }).click()
      await expectUI(
        page.getByText("翻译项目时附件只读。", { exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "移除引用", exact: true })
      ).toHaveCount(0)
      await page.getByRole("button", { name: "取消", exact: true }).click()
      await context.clearCookies()
      const editor = await role(f, {
        project: ["read", "update"],
        file: ["read"],
        folder: ["read"],
      })
      await signIn(editor.actor, f.organization)
      await page.goto(environment.tenantOrigin + projectPath(f, project.id))
      await page.getByRole("button", { name: "编辑项目", exact: true }).click()
      await page.getByLabel("描述", { exact: true }).fill("撤权后保留")
      await page.getByRole("button", { name: "移除引用", exact: true }).click()
      const previousAccess = await request(f, "/access")
      const previousVersion = (await previousAccess.json()).authorizationVersion
      const beforeRevocationChecks = filePermissionRequestCount()
      const beforeRevocationProjectChecks = projectEditPermissionRequestCount()
      await changeRole(f, editor, {
        project: ["read"],
        file: ["read"],
        folder: ["read"],
      })
      await editSave(f, project.id, 403)
      const currentAccess = await request(f, "/access")
      expect((await currentAccess.json()).authorizationVersion).toBeGreaterThan(
        previousVersion
      )
      await expectUI
        .poll(() => filePermissionRequestCount() - beforeRevocationChecks)
        .toBe(10)
      await expectUI
        .poll(
          () =>
            projectEditPermissionRequestCount() - beforeRevocationProjectChecks
        )
        .toBe(2)
      await expectUI(
        page.getByRole("button", { name: "保存项目", exact: true })
      ).toBeDisabled()
      await expectUI(page.getByLabel("描述", { exact: true })).toHaveValue(
        "撤权后保留"
      )
      await expectUI(page.getByText("暂无附件", { exact: true })).toBeVisible()
      expect((await attachments(f, project.id)).items[0].versionId).toBe(
        uploaded.versionId
      )
      await page.getByRole("button", { name: "取消", exact: true }).click()
      await page.getByRole("button", { name: /项目委派用户/ }).click()
      const englishLanguage = page.getByRole("menuitem", {
        name: "语言",
        exact: true,
      })
      await englishLanguage.focus()
      await englishLanguage.press("Enter")
      const english = page.getByRole("menuitemradio", {
        name: "English",
        exact: true,
      })
      await english.focus()
      await english.press("Enter")
      await expectUI(
        page.getByRole("heading", { name: "Attachments", exact: true })
      ).toBeVisible()
      await expectUI(page.getByText(/Version created/)).toBeVisible()
      await page.getByRole("button", { name: /项目委派用户/ }).click()
      const language = page.getByRole("menuitem", {
        name: "Language",
        exact: true,
      })
      await language.focus()
      await language.press("Enter")
      const option = page.getByRole("menuitemradio", {
        name: "العربية",
        exact: true,
      })
      await option.focus()
      await option.press("Enter")
      await expectUI(
        page.getByRole("heading", { name: "المرفقات", exact: true })
      ).toBeVisible()
      await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
      await expectUI(
        page.getByRole("menu", { includeHidden: true })
      ).toHaveCount(0)
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
    })
    it("两个真实上传任务中第一项完成刷新选择器，第二项继续到完成且目标目录保持不变", async () => {
      const f = await fixture()
      await signIn(f.owner, f.organization)
      await page.goto(environment.tenantOrigin + projectPath(f))
      await page.getByRole("button", { name: "创建项目", exact: true }).click()
      await page.getByLabel("项目名称", { exact: true }).fill("并行附件上传")
      await page.getByRole("button", { name: "添加附件", exact: true }).click()
      const picker = page.getByRole("dialog", { name: "选择文件", exact: true })
      await picker
        .getByRole("button", { name: "上传文件", exact: true })
        .click()
      const upload = page.getByRole("dialog", { name: "上传文件", exact: true })
      let release,
        held = false
      const gate = new Promise((resolve) => {
        release = resolve
      })
      await page.route("**/files/uploads", async (route) => {
        if (
          route.request().postDataBuffer().includes(Buffer.from("second.txt"))
        ) {
          held = true
          await gate
        }
        await route.continue()
      })
      const firstResponse = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/files/uploads") &&
          r.request().postDataBuffer().includes(Buffer.from("first.txt"))
      )
      const secondResponse = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/files/uploads") &&
          r.request().postDataBuffer().includes(Buffer.from("second.txt"))
      )
      try {
        await upload.getByLabel("选择文件", { exact: true }).setInputFiles([
          { name: "first.txt", mimeType: "text/plain", buffer: original },
          { name: "second.txt", mimeType: "text/plain", buffer: replacement },
        ])
        await upload
          .getByRole("button", { name: "开始上传", exact: true })
          .click()
        const first = await firstResponse
        expect(first.status(), await first.text()).toBe(200)
        expect((await first.json()).phase).toBe("completed")
        await expectUI.poll(() => held).toBe(true)
        // 第一项的生产完成回执触发实际列表刷新；第二项请求仍等待网络放行。
        await expectUI(
          picker.getByRole("button", { name: "first.txt", exact: true })
        ).toBeVisible()
        release()
        const second = await secondResponse
        expect(second.status(), await second.text()).toBe(200)
        const receipt = await second.json()
        expect(receipt.phase).toBe("completed")
        await expectUI(
          picker.getByRole("button", { name: "second.txt", exact: true })
        ).toBeVisible()
        await picker.getByRole("button", { name: "取消", exact: true }).click()
        const queue = page.getByRole("region", {
          name: "上传任务",
          exact: true,
        })
        await expectUI(
          queue
            .getByRole("listitem", { name: "first.txt", exact: true })
            .getByRole("status")
        ).toHaveText("上传完成")
        await expectUI(
          queue
            .getByRole("listitem", { name: "second.txt", exact: true })
            .getByRole("status")
        ).toHaveText("上传完成")
        const entry = await request(
          f,
          `/files/entries/${receipt.result.entryId}`
        )
        expect(await entry.json()).toMatchObject({
          parentId: f.root.id,
          name: "second.txt",
          currentVersion: {
            id: receipt.result.versionId,
            bytes: replacement.length,
          },
        })
      } finally {
        release()
        await page.unroute("**/files/uploads")
      }
    })
  })
