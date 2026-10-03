import { containerHostURL } from "../setup/container-host.mjs"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
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
import { FileOperationResponseSchema } from "../../packages/contracts/dist/index.js"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)
const labels = Object.fromEntries(
  await Promise.all(
    ["zh-CN", "en-US", "ar"].map(async (locale) => [
      locale,
      JSON.parse(
        await readFile(`packages/i18n/src/locales/${locale}/files.json`, "utf8")
      ),
    ])
  )
)
const sha = (body) => createHash("sha256").update(body).digest("hex")
const json = (body) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

async function startBackend(kind, resources) {
  if (kind === "RustFS") {
    const accessKeyId = randomBytes(12).toString("hex"),
      secretAccessKey = randomBytes(32).toString("hex")
    const container = await new GenericContainer(versions.rustfs.image)
      .withEnvironment({
        RUSTFS_ACCESS_KEY: accessKeyId,
        RUSTFS_SECRET_KEY: secretAccessKey,
        RUSTFS_ADDRESS: ":9000",
        RUSTFS_CONSOLE_ENABLE: "false",
      })
      .withCommand(["/data"])
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forHttp("/health/ready", 9000).forStatusCode(200))
      .start()
    resources.defer(() => container.stop())
    const files = {
      kind: "s3",
      region: "us-east-1",
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      bucket: `path-product-${randomUUID()}`,
      prefix: "path-product",
      accessKeyId,
      secretAccessKey,
    }
    const client = new S3Client({
      endpoint: files.endpoint,
      region: files.region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 1,
    })
    resources.defer(() => client.destroy())
    await client.send(new CreateBucketCommand({ Bucket: files.bucket }))
    const environment = await startBrowserApplication({ files })
    resources.defer(() => environment.close())
    const storage = environment.app.get(FilesRuntime).requireStorage()
    return {
      ...environment,
      physical: async (address) => {
        try {
          const read = await storage.open(address),
            chunks = []
          for await (const chunk of read.body) chunks.push(chunk)
          return Buffer.concat(chunks)
        } catch (error) {
          if (error.code === "STORAGE_NOT_FOUND") return null
          throw error
        }
      },
      directory: (address) => storage.directoryExists(address),
    }
  }
  let container
  const environment = await startBrowserApplication({
    startApiServer: async (runtime) => {
      const config = {
        ...runtime.config,
        databaseURL: await containerHostURL(runtime.config.databaseURL),
        redisURL: await containerHostURL(runtime.config.redisURL),
        files: { kind: "local", root: "/tmp/path-product-files" },
      }
      // Local 的正式存储能力要求 Linux 大小写敏感文件系统；数据保存在容器中而非 macOS 挂载卷。
      container = await new GenericContainer(versions.nodeImage)
        .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
        .withWorkingDir("/app")
        .withEnvironment({ PATH_PRODUCT_CONFIG: JSON.stringify(config) })
        .withExposedPorts(3000)
        .withCommand([
          "node",
          "-e",
          `const {mkdir}=require('node:fs/promises');const {createApplication}=require('./apps/api/dist/create-application.js');const config=JSON.parse(process.env.PATH_PRODUCT_CONFIG);config.email.encryptionKey=Buffer.from(config.email.encryptionKey.data);let app;(async()=>{await mkdir(config.files.root,{recursive:true,mode:0o700});app=await createApplication(config,{logger:false});await app.listen(3000,'0.0.0.0');console.log('PATH_PRODUCT_READY');process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));})().catch(async error=>{console.error(error.code??error.message);await app?.close();process.exit(1)});`,
        ])
        .withWaitStrategy(Wait.forLogMessage("PATH_PRODUCT_READY"))
        .start()
      return {
        baseURL: `http://${container.getHost()}:${container.getMappedPort(3000)}`,
        close: () => container.stop(),
      }
    },
  })
  resources.defer(() => environment.close())
  async function physical(address, directory = false) {
    const response = await container.exec([
      "node",
      "-e",
      `const {createFileStorage}=require('./apps/api/dist/files/storage/storage.js');(async()=>{const storage=await createFileStorage(JSON.parse(process.env.PATH_PRODUCT_CONFIG).files),address=JSON.parse(process.argv[1]);if(process.argv[2]==='directory'){console.log(JSON.stringify(await storage.directoryExists(address)));return}try{const read=await storage.open(address),chunks=[];for await(const chunk of read.body)chunks.push(chunk);console.log(JSON.stringify(Buffer.concat(chunks).toString('base64')))}catch(error){if(error.code==='STORAGE_NOT_FOUND')console.log('null');else throw error}})().catch(error=>{console.error(error.code??error.message);process.exit(1)});`,
      JSON.stringify(address),
      directory ? "directory" : "file",
    ])
    if (response.exitCode !== 0)
      throw new Error("Local physical observation failed: " + response.output)
    const value = JSON.parse(response.output.trim())
    return directory || value === null ? value : Buffer.from(value, "base64")
  }
  return {
    ...environment,
    physical: (address) => physical(address),
    directory: (address) => physical(address, true),
  }
}

async function signIn(page, account, tenantOrigin) {
  await page.goto(tenantOrigin + "/app/")
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await page.getByRole("link", { name: "文件", exact: true }).click()
}
async function selectLocale(page, account, language) {
  await page
    .getByRole("button", { name: new RegExp(account.user.name) })
    .click()
  const menu = page.getByRole("menuitem", { name: "语言", exact: true })
  await menu.focus()
  await menu.press("Enter")
  const item = page.getByRole("menuitemradio", { name: language, exact: true })
  await item.focus()
  await item.press("Enter")
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQImWP4z8DwnwGM/zMwAAAf7gP9qS/A4gAAAABJRU5ErkJggg==",
  "base64"
)

describe.each(["Local", "RustFS"])(
  "S9 %s：正式文件详情、业务引用与回收站产品链路",
  (kind) => {
    const resources = new AsyncDisposableStack()
    let environment, context, page
    beforeAll(async () => {
      try {
        environment = await startBackend(kind, resources)
      } catch (error) {
        await resources.disposeAsync()
        throw error
      }
    })
    afterAll(() => resources.disposeAsync())
    beforeEach(async () => {
      context = await environment.browser.newContext({
        viewport: { width: 1360, height: 1000 },
        extraHTTPHeaders: {
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
      })
      page = await context.newPage()
    })
    afterEach(() => context.close())
    const request = (f, suffix, options = {}, actor = f.owner) =>
      fetch(
        environment.baseURL +
          `/api/v1/organizations/${f.organization.id}${suffix}`,
        {
          ...options,
          headers: { ...Object.fromEntries(actor.headers), ...options.headers },
        }
      )
    const address = (f, area, segments) => ({
      owner: { kind: "organization", id: f.organization.id },
      area,
      segments,
    })
    const row = (name) =>
      page
        .locator('[data-slot="data-table"] tbody')
        .getByRole("row")
        .filter({
          has: page
            .getByRole("button", { name, exact: true })
            .and(page.locator("button[id]")),
        })
    const refs = (locale = "zh-CN") =>
      page.getByRole("region", {
        name: labels[locale].referencesTitle,
        exact: true,
      })
    const detailUrl = (f, entry, versionId) =>
      environment.tenantOrigin +
      `/app/files/${f.organization.id}/entries/${entry.id}` +
      (versionId ? `?versionId=${versionId}` : "")
    const contentPath = (file) =>
      `/files/entries/${file.id}/versions/${file.fixedVersionId}/content`
    async function native(f, suffix, input, method = "POST") {
      const response = await request(
        f,
        suffix,
        input === undefined ? {} : { ...json(input), method }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    async function fixture() {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "详情验收用户" }
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "详情验收组织", slug: `file-detail-${randomUUID()}` },
        })
      const f = { owner, organization }
      f.root = (await native(f, "/files/workspace")).root
      return f
    }
    async function folder(f, name, parent = f.root) {
      const receipt = await native(f, "/files/folders", {
        operationId: randomUUID(),
        parentId: parent.id,
        name,
      })
      expect(receipt.phase).toBe("completed")
      return native(f, `/files/entries/${receipt.result.entryId}`)
    }
    async function upload(
      f,
      name,
      parent = f.root,
      bytes = Buffer.from("原始固定版本字节"),
      overwrite,
      type = "text/plain"
    ) {
      const form = new FormData()
      for (const [key, value] of Object.entries({
        operationId: randomUUID(),
        ...(overwrite
          ? { expectedRevision: overwrite.revision }
          : { parentId: parent.id, name }),
        contentSha256: sha(bytes),
        declaredBytes: bytes.length,
      }))
        form.append(key, String(value))
      form.append("file", new File([bytes], name, { type }))
      const response = await request(
        f,
        overwrite
          ? `/files/entries/${overwrite.id}/overwrite`
          : "/files/uploads",
        { method: "POST", body: form }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const receipt = FileOperationResponseSchema.parse(await response.json())
      expect(receipt.phase).toBe("completed")
      return {
        ...(await native(f, `/files/entries/${receipt.result.entryId}`)),
        originalBytes: bytes,
        fixedVersionId: receipt.result.versionId,
      }
    }
    async function createReferences(f, file, translated = false) {
      const reference = { fileId: file.id, versionId: file.fixedVersionId }
      const response = await request(
        f,
        "/projects",
        json({
          name: "附件与正文引用项目",
          description: "仍是纯文本概要",
          contentLocale: "zh-CN",
          attachments: [reference],
        })
      )
      expect(response.status, await response.clone().text()).toBe(201)
      const project = await response.json()
      const document = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Native 正文引用" }],
          },
          { type: "fileImage", attrs: { ...reference, alt: "正式图片" } },
          {
            type: "fileAttachment",
            attrs: { ...reference, label: "固定附件" },
          },
        ],
      }
      await native(
        f,
        `/projects/${project.id}/content/zh-CN`,
        { expectedRevision: null, document },
        "PUT"
      )
      if (translated) {
        for (const [locale, name] of [
          ["en-US", "English file project"],
          ["ar", "مشروع الملفات"],
        ])
          await native(
            f,
            `/projects/${project.id}`,
            { translation: { locale, name, description: null } },
            "PATCH"
          )
      }
      return project
    }
    async function openFiles(f, actor = f.owner) {
      await signIn(page, actor, environment.tenantOrigin)
      await expectUI(
        page.locator('[data-slot="data-table"] tbody')
      ).toBeVisible()
    }
    async function openDetail(f, entry, versionId) {
      await page.goto(detailUrl(f, entry, versionId))
      await expectUI(
        page.getByRole("heading", { level: 1, name: entry.name, exact: true })
      ).toBeVisible()
    }
    async function action(entry, action, locale = "zh-CN", keyboard = false) {
      const trigger = page.getByRole("button", {
        name: labels[locale][action + "Entry"],
        exact: true,
      })
      if (keyboard) {
        await trigger.focus()
        await trigger.press("Enter")
      } else await trigger.click()
      const dialog = page.getByRole("dialog", {
        name: labels[locale][action + "Entry"],
        exact: true,
      })
      await expectUI(dialog).toBeVisible()
      return dialog
    }
    async function submit(f, entry, action, dialog, locale = "zh-CN") {
      const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname ===
            `/api/v1/organizations/${f.organization.id}/files/entries/${entry.id}/${action}`
      )
      await dialog
        .getByRole("button", {
          name: labels[locale][action + "Entry"],
          exact: true,
        })
        .click()
      const response = await responsePromise
      expect(response.status(), await response.text()).toBe(200)
      const receipt = FileOperationResponseSchema.parse(await response.json())
      expect(receipt.phase).toBe("completed")
      await expectUI(dialog).toHaveCount(0)
      return receipt
    }
    async function destination(dialog, target) {
      await dialog
        .getByRole("button", { name: labels["zh-CN"].destination, exact: true })
        .click()
      const picker = page.getByRole("dialog", {
        name: labels["zh-CN"].pickFolder,
        exact: true,
      })
      await picker
        .locator("tbody")
        .getByRole("button", { name: target.name, exact: true })
        .click()
      await picker
        .getByRole("button", { name: labels["zh-CN"].useFolder, exact: true })
        .click()
      await expectUI(picker).toHaveCount(0)
      await expectUI(dialog).toContainText(target.name)
    }
    async function fixedBytes(f, file, actor = f.owner) {
      const response = await request(f, contentPath(file), {}, actor)
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(
        file.originalBytes
      )
    }
    async function trashNative(f, entry) {
      return native(f, `/files/entries/${entry.id}/trash`, {
        operationId: randomUUID(),
        expectedRevision: entry.revision,
      })
    }
    async function usage(f, expected) {
      expect(
        (
          await environment.observer.query(
            "SELECT used_bytes,reserved_bytes,transient_bytes FROM file_storage_usage WHERE organization_id=$1",
            [f.organization.id]
          )
        ).rows[0]
      ).toEqual({
        used_bytes: String(expected),
        reserved_bytes: "0",
        transient_bytes: "0",
      })
    }
    async function customActor(f, permission) {
      const actor = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "引用权限验收成员" }
      )
      const role = await environment.runtime.auth.api.createOrgRole({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          role: "reference-reader",
          permission,
        },
      })
      await environment.runtime.auth.api.addMember({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          userId: actor.user.id,
          role: "reference-reader",
        },
      })
      return { actor, role }
    }
    async function changeRole(f, role, permission) {
      const version = (
        await environment.observer.query(
          "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
          [f.organization.id]
        )
      ).rows[0].authorization_version
      const response = await fetch(
        environment.baseURL + "/api/auth/organization/update-role",
        {
          ...json({
            organizationId: f.organization.id,
            roleId: role.roleData.id,
            data: { permission },
          }),
          headers: {
            ...Object.fromEntries(f.owner.headers),
            "content-type": "application/json",
            "X-Expected-Authz-Version": String(version),
          },
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
    }

    it("选择目录后由正式详情链接进入，改名与移动更新整树事实并回到真实父目录", async () => {
      const f = await fixture(),
        tree = await folder(f, "详情目录"),
        target = await folder(f, "目标父目录"),
        child = await upload(f, "目录子文件.txt", tree)
      await openFiles(f)
      await row(tree.name).getByRole("checkbox").check()
      const link = page.getByRole("link", {
        name: labels["zh-CN"].detail,
        exact: true,
      })
      await expectUI(link).toHaveAttribute(
        "href",
        `/app/files/${f.organization.id}/entries/${tree.id}`
      )
      await link.click()
      await expectUI(
        page.getByRole("heading", { level: 1, name: tree.name, exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByText(labels["zh-CN"].folder, { exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: labels["zh-CN"].preview, exact: true })
      ).toHaveCount(0)
      const rename = await action(tree, "rename")
      await rename.getByLabel("名称", { exact: true }).fill("更名详情目录")
      await submit(f, tree, "rename", rename)
      const renamed = await native(f, `/files/entries/${tree.id}`)
      await expectUI(
        page.getByRole("heading", { level: 1, name: renamed.name, exact: true })
      ).toBeVisible()
      const move = await action(renamed, "move")
      await destination(move, target)
      await submit(f, renamed, "move", move)
      await expectUI(
        page.getByText(`${target.name} / ${renamed.name}`, { exact: true })
      ).toBeVisible()
      expect((await native(f, `/files/entries/${child.id}`)).path).toEqual([
        target.name,
        renamed.name,
        child.name,
      ])
      await fixedBytes(f, child)
      expect(
        await environment.physical(
          address(f, "files", [target.name, renamed.name, child.name])
        )
      ).toEqual(child.originalBytes)
      await page
        .getByRole("link", { name: labels["zh-CN"].openLocation, exact: true })
        .click()
      await expectUI(page).toHaveURL(new RegExp(`parentId=${target.id}`))
      await expectUI(row(renamed.name)).toBeVisible()
    })

    it("详情改名、移动与明确覆盖不改 URL 固定版本，历史预览和下载保持原字节", async () => {
      const f = await fixture(),
        target = await folder(f, "详情移动目标"),
        original = await upload(f, "详情原文件.txt")
      await openFiles(f)
      await row(original.name).getByRole("checkbox").check()
      await page
        .getByRole("link", { name: labels["zh-CN"].detail, exact: true })
        .click()
      await openDetail(f, original, original.fixedVersionId)
      const rename = await action(original, "rename")
      await rename.getByLabel("名称", { exact: true }).fill("详情新名称.txt")
      await submit(f, original, "rename", rename)
      const renamed = await native(f, `/files/entries/${original.id}`)
      await expectUI(
        page.getByRole("heading", { level: 1, name: renamed.name, exact: true })
      ).toBeVisible()
      const move = await action(renamed, "move")
      await destination(move, target)
      await submit(f, renamed, "move", move)
      await expectUI(
        page.getByRole("link", {
          name: labels["zh-CN"].openLocation,
          exact: true,
        })
      ).toHaveAttribute(
        "href",
        `/app/files/${f.organization.id}?parentId=${target.id}`
      )
      await expectUI(page).toHaveURL(
        new RegExp(`versionId=${original.fixedVersionId}`)
      )
      await page
        .getByRole("button", {
          name: labels["zh-CN"].overwriteFile,
          exact: true,
        })
        .click()
      const dialog = page.getByRole("dialog", {
        name: labels["zh-CN"].overwriteFile,
        exact: true,
      })
      const replacement = Buffer.from("详情覆盖后的新字节")
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "选择的新文件.txt",
        mimeType: "text/plain",
        buffer: replacement,
      })
      const submitted = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname.endsWith(
            `/entries/${original.id}/overwrite`
          )
      )
      await dialog
        .getByRole("button", {
          name: labels["zh-CN"].confirmOverwrite,
          exact: true,
        })
        .click()
      const response = await submitted
      expect(response.status()).toBe(200)
      const receipt = FileOperationResponseSchema.parse(await response.json())
      expect(receipt.phase).toBe("completed")
      await expectUI(dialog).toHaveCount(0)
      const current = await native(f, `/files/entries/${original.id}`)
      expect(current.path).toEqual([target.name, renamed.name])
      expect(current.currentVersion.id).not.toBe(original.fixedVersionId)
      expect(current.currentVersion.id).toBe(receipt.result.versionId)
      await expectUI(page).toHaveURL(
        new RegExp(`versionId=${original.fixedVersionId}`)
      )
      await expectUI(
        page.getByRole("region", { name: labels["zh-CN"].content, exact: true })
      ).toContainText(labels["zh-CN"].historicalVersion)
      await page
        .getByRole("button", { name: labels["zh-CN"].preview, exact: true })
        .click()
      const sheet = page.getByRole("dialog")
      await expectUI(
        sheet.getByLabel(labels["zh-CN"].textContent, { exact: true })
      ).toHaveText(original.originalBytes.toString())
      await sheet.getByRole("button", { name: "关闭", exact: true }).click()
      const download = page.waitForEvent("download")
      await page
        .getByRole("button", { name: labels["zh-CN"].download, exact: true })
        .click()
      const fileDownload = await download
      expect(fileDownload.suggestedFilename()).toBe(renamed.name)
      expect(await readFile(await fileDownload.path())).toEqual(
        original.originalBytes
      )
      await fixedBytes(f, original)
      const fresh = await request(
        f,
        `/files/entries/${original.id}/versions/${current.currentVersion.id}/content`
      )
      expect(fresh.status).toBe(200)
      expect(Buffer.from(await fresh.arrayBuffer())).toEqual(replacement)
      await usage(f, original.originalBytes.length + replacement.length)
      await page.reload()
      await expectUI(page).toHaveURL(
        new RegExp(`versionId=${original.fixedVersionId}`)
      )
      await expectUI(
        page.getByRole("region", { name: labels["zh-CN"].content, exact: true })
      ).toContainText(labels["zh-CN"].historicalVersion)
    })

    it("Native附件与原生富文本引用投影准确位置、项目和固定版本链接，目录子树同样可定位阻塞", async () => {
      const f = await fixture(),
        tree = await folder(f, "被引用目录"),
        original = await upload(
          f,
          "被引用.png",
          tree,
          png,
          undefined,
          "image/png"
        ),
        project = await createReferences(f, original)
      await upload(f, original.name, tree, png, original, "image/png")
      await openFiles(f)
      await openDetail(f, original)
      await expectUI(refs()).toContainText("3 处业务引用")
      await expectUI(refs().getByRole("listitem")).toHaveCount(3)
      await expectUI(
        refs().getByText(labels["zh-CN"].referenceAttachment, { exact: true })
      ).toHaveCount(1)
      await expectUI(
        refs().getByText("项目正文 · zh-CN", { exact: true })
      ).toHaveCount(2)
      const projectLinks = refs().getByRole("link", {
        name: project.name,
        exact: true,
      })
      await expectUI(projectLinks).toHaveCount(3)
      await expectUI(projectLinks.first()).toHaveAttribute(
        "href",
        `/app/projects/${f.organization.id}/${project.id}`
      )
      const versionLinks = refs().getByRole("link", {
        name: `绑定版本：${original.fixedVersionId}`,
        exact: true,
      })
      await expectUI(versionLinks).toHaveCount(3)
      await expectUI(versionLinks.first()).toHaveAttribute(
        "href",
        `/app/files/${f.organization.id}/entries/${original.id}?versionId=${original.fixedVersionId}`
      )
      await versionLinks.first().click()
      await expectUI(page).toHaveURL(
        new RegExp(`versionId=${original.fixedVersionId}`)
      )
      await expectUI(
        page.getByRole("region", { name: labels["zh-CN"].content, exact: true })
      ).toContainText(labels["zh-CN"].historicalVersion)
      await refs()
        .getByRole("link", { name: project.name, exact: true })
        .first()
        .click()
      await expectUI(
        page.getByRole("heading", { level: 1, name: project.name, exact: true })
      ).toBeVisible()
      await openDetail(f, tree)
      await expectUI(
        refs().getByRole("link", {
          name: `绑定版本：${original.fixedVersionId}`,
          exact: true,
        })
      ).toHaveCount(3)
      const dialog = await action(tree, "trash")
      await expectUI(dialog.getByRole("alert")).toContainText("业务引用：3 个")
      await expectUI(
        dialog
          .getByRole("region", {
            name: labels["zh-CN"].referencesTitle,
            exact: true,
          })
          .getByRole("listitem")
      ).toHaveCount(3)
      await expectUI(
        dialog.getByRole("button", {
          name: labels["zh-CN"].trashEntry,
          exact: true,
        })
      ).toBeDisabled()
      await dialog.getByRole("button", { name: "取消", exact: true }).click()
      expect((await native(f, `/files/entries/${tree.id}`)).state).toBe(
        "active"
      )
      await fixedBytes(f, original)
    })

    it("没有project:read的Native成员仅见引用数量，详情和删除预检均不泄露项目位置", async () => {
      const f = await fixture(),
        file = await upload(
          f,
          "无项目权限.png",
          f.root,
          png,
          undefined,
          "image/png"
        ),
        project = await createReferences(f, file)
      const { actor } = await customActor(f, {
        file: ["read", "delete"],
        folder: ["read"],
      })
      await openFiles(f, actor)
      await openDetail(f, file)
      await expectUI(refs()).toContainText("3 处业务引用")
      await expectUI(refs()).toContainText(
        "另有 3 处引用需要相应业务读取权限才能查看。"
      )
      await expectUI(refs().getByRole("link")).toHaveCount(0)
      await expectUI(page.getByText(project.name, { exact: true })).toHaveCount(
        0
      )
      const dialog = await action(file, "trash")
      await expectUI(dialog).toContainText("业务引用：3 个")
      await expectUI(
        dialog.getByRole("region", { name: labels["zh-CN"].referencesTitle })
      ).toContainText("另有 3 处引用")
      await expectUI(dialog.getByRole("link")).toHaveCount(0)
      await expectUI(
        dialog.getByRole("button", {
          name: labels["zh-CN"].trashEntry,
          exact: true,
        })
      ).toBeDisabled()
      const response = await request(
        f,
        `/files/entries/${file.id}/references`,
        {},
        actor
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ total: 3, items: [] })
      const forbidden = await request(f, `/projects/${project.id}`, {}, actor)
      expect(forbidden.status).toBe(403)
      await fixedBytes(f, file, actor)
    })

    it("Native角色实时撤project:read后原Cookie只能得到数量，重读详情清除缓存位置", async () => {
      const f = await fixture(),
        file = await upload(
          f,
          "撤回项目读取.png",
          f.root,
          png,
          undefined,
          "image/png"
        ),
        project = await createReferences(f, file)
      const permission = { file: ["read"], folder: ["read"], project: ["read"] }
      const { actor, role } = await customActor(f, permission)
      await openFiles(f, actor)
      await openDetail(f, file)
      await expectUI(
        refs().getByRole("link", { name: project.name, exact: true })
      ).toHaveCount(3)
      await changeRole(f, role, { file: ["read"], folder: ["read"] })
      const response = await request(
        f,
        `/files/entries/${file.id}/references`,
        {},
        actor
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ total: 3, items: [] })
      expect(
        (await request(f, `/projects/${project.id}`, {}, actor)).status
      ).toBe(403)
      await page.reload()
      await expectUI(refs()).toContainText("另有 3 处引用")
      await expectUI(refs().getByRole("link")).toHaveCount(0)
      await expectUI(page.getByText(project.name, { exact: true })).toHaveCount(
        0
      )
      await fixedBytes(f, file, actor)
    })

    it("独立回收文件详情不请求正文，原父仍有效时返回回收根；恢复后原固定版本可读，永久删除回到回收根", async () => {
      const f = await fixture(),
        parent = await folder(f, "仍有效的父目录"),
        original = await upload(f, "回收详情.txt", parent),
        current = await upload(
          f,
          original.name,
          parent,
          Buffer.from("回收前第二版本"),
          original
        )
      const deleted = await trashNative(f, current)
      await openFiles(f)
      const detailRequests = []
      page.on("request", (request) => {
        if (
          new URL(request.url()).pathname.startsWith(
            `/api/v1/organizations/${f.organization.id}/files/entries/${original.id}/`
          )
        )
          detailRequests.push(new URL(request.url()).pathname)
      })
      await openDetail(f, current, original.fixedVersionId)
      await expectUI(
        page.getByText(labels["zh-CN"].trashedContentUnavailable, {
          exact: true,
        })
      ).toBeVisible()
      await expectUI(
        page.getByText(`${parent.name} / ${current.name}`, { exact: true })
      ).toBeVisible()
      for (const label of ["originalLocation", "deletedAt", "expiresAt"])
        await expectUI(
          page.getByText(labels["zh-CN"][label], { exact: true })
        ).toBeVisible()
      for (const label of [
        "preview",
        "download",
        "overwriteFile",
        "renameEntry",
        "moveEntry",
        "trashEntry",
      ])
        await expectUI(
          page.getByRole("button", {
            name: labels["zh-CN"][label],
            exact: true,
          })
        ).toHaveCount(0)
      expect(
        detailRequests.filter((path) =>
          /\/(versions|content|references)(\/|$)/.test(path)
        )
      ).toEqual([])
      expect((await request(f, contentPath(original))).status).toBe(404)
      const location = page.getByRole("link", {
        name: labels["zh-CN"].openLocation,
        exact: true,
      })
      await expectUI(location).toHaveAttribute(
        "href",
        `/app/files/${f.organization.id}?state=trashed`
      )
      await location.click()
      await expectUI(row(current.name)).toBeVisible()
      await openDetail(f, current)
      const restore = await action(current, "restore")
      await submit(f, current, "restore", restore)
      await expectUI(
        page.getByRole("button", { name: labels["zh-CN"].preview, exact: true })
      ).toBeVisible()
      await fixedBytes(f, original)
      const restored = await native(f, `/files/entries/${original.id}`)
      expect(restored.parentId).toBe(parent.id)
      await page
        .getByRole("link", { name: labels["zh-CN"].openLocation, exact: true })
        .click()
      await expectUI(page).toHaveURL(new RegExp(`parentId=${parent.id}`))
      await expectUI(row(current.name)).toBeVisible()
      await openDetail(f, restored)
      const trash = await action(restored, "trash")
      await submit(f, restored, "trash", trash)
      await expectUI(
        page.getByText(labels["zh-CN"].trashedContentUnavailable, {
          exact: true,
        })
      ).toBeVisible()
      const purge = await action(restored, "purge")
      await expectUI(purge).toContainText(labels["zh-CN"].purgeDescription)
      await expectUI(
        purge.getByRole("button", {
          name: labels["zh-CN"].purgeEntry,
          exact: true,
        })
      ).toBeEnabled()
      await submit(f, restored, "purge", purge)
      await expectUI(page).toHaveURL(
        (url) =>
          url.pathname === `/app/files/${f.organization.id}` &&
          url.searchParams.get("state") === "trashed" &&
          !url.searchParams.has("parentId")
      )
      await expectUI(
        page.getByText(labels["zh-CN"].emptyTrash, { exact: true })
      ).toBeVisible()
      expect((await request(f, `/files/entries/${original.id}`)).status).toBe(
        404
      )
      expect((await request(f, contentPath(original))).status).toBe(404)
      expect(
        await environment.physical(
          address(f, "trash", [original.id, original.fixedVersionId])
        )
      ).toBeNull()
      expect(
        await environment.physical(
          address(f, "trash", [original.id, current.fixedVersionId])
        )
      ).toBeNull()
      expect(
        await environment.physical(
          address(f, "history", [original.id, original.fixedVersionId])
        )
      ).toBeNull()
      expect(
        await environment.physical(
          address(f, "files", [parent.name, original.name])
        )
      ).toBeNull()
      await usage(f, 0)
      expect(deleted.phase).toBe("completed")
    })

    it("深层回收子项详情打开真实回收父位置，刷新保持层级；回收根目录从详情还原整树", async () => {
      const f = await fixture(),
        outer = await folder(f, "外层原目录"),
        tree = await folder(f, "回收树根", outer),
        nested = await folder(f, "回收深层", tree),
        child = await upload(f, "回收子项.txt", nested)
      await trashNative(f, tree)
      await openFiles(f)
      await openDetail(f, child, child.fixedVersionId)
      const link = page.getByRole("link", {
        name: labels["zh-CN"].openLocation,
        exact: true,
      })
      await expectUI(link).toHaveAttribute(
        "href",
        `/app/files/${f.organization.id}?state=trashed&parentId=${nested.id}`
      )
      await link.click()
      await expectUI(row(child.name)).toBeVisible()
      const url = page.url()
      await page.reload()
      await expectUI(row(child.name)).toBeVisible()
      expect(page.url()).toBe(url)
      await expectUI(
        page.getByRole("navigation", { name: labels["zh-CN"].folderNavigation })
      ).toContainText(tree.name)
      expect((await request(f, contentPath(child))).status).toBe(404)
      await openDetail(f, tree)
      await expectUI(
        page.getByRole("link", {
          name: labels["zh-CN"].openLocation,
          exact: true,
        })
      ).toHaveAttribute("href", `/app/files/${f.organization.id}?state=trashed`)
      const restore = await action(tree, "restore")
      await submit(f, tree, "restore", restore)
      await expectUI(
        page.getByText(labels["zh-CN"].folder, { exact: true })
      ).toBeVisible()
      await fixedBytes(f, child)
      expect((await native(f, `/files/entries/${child.id}`)).path).toEqual([
        outer.name,
        tree.name,
        nested.name,
        child.name,
      ])
      expect(
        await environment.physical(
          address(f, "files", [outer.name, tree.name, nested.name, child.name])
        )
      ).toEqual(child.originalBytes)
      await usage(f, child.originalBytes.length)
    })

    it.each([
      ["en-US", "English", false, "English file project"],
      ["ar", "العربية", true, "مشروع الملفات"],
    ])(
      "%s详情键盘改名、引用翻译与RTL使用正式同一条目和稳定固定版本",
      async (locale, language, rtl, projectName) => {
        const f = await fixture(),
          original = await upload(
            f,
            "多语详情.png",
            f.root,
            png,
            undefined,
            "image/png"
          )
        await createReferences(f, original, true)
        await openFiles(f)
        await openDetail(f, original, original.fixedVersionId)
        await selectLocale(page, f.owner, language)
        if (rtl)
          await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
        await expectUI(
          refs(locale).getByRole("link", { name: projectName, exact: true })
        ).toHaveCount(3)
        const rename = await action(original, "rename", locale, true)
        await rename
          .getByRole("textbox")
          .fill(rtl ? "صورة جديدة.png" : "Renamed detail.png")
        await submit(f, original, "rename", rename, locale)
        const changed = await native(f, `/files/entries/${original.id}`)
        await expectUI(
          page.getByRole("heading", {
            level: 1,
            name: changed.name,
            exact: true,
          })
        ).toBeVisible()
        await expectUI(page).toHaveURL(
          new RegExp(`versionId=${original.fixedVersionId}`)
        )
        await expectUI(
          page.getByRole("button", {
            name: labels[locale].renameEntry,
            exact: true,
          })
        ).toBeFocused()
        const version = refs(locale)
          .getByRole("link")
          .filter({ hasText: original.fixedVersionId })
          .first()
        await version.focus()
        await version.press("Enter")
        await expectUI(page).toHaveURL(
          new RegExp(`versionId=${original.fixedVersionId}`)
        )
        await fixedBytes(f, original)
        await usage(f, png.length)
      }
    )
  }
)
