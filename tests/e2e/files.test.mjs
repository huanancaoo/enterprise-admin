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
import { createTenantRunner } from "../../packages/database/dist/tenant.js"
import { fileRepository } from "../../packages/database/dist/repositories/files.js"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startBrowserApplication } from "../setup/test-runtime.mjs"

const storybookRequire = createRequire(resolve("apps/storybook/package.json"))
const a11yRequire = createRequire(
  storybookRequire.resolve("@storybook/addon-a11y")
)
const require = createRequire(resolve("apps/api/package.json"))
const {
  S3Client,
  CreateBucketCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3")
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const {
  TenantContextService,
} = require("../../apps/api/dist/tenancy/tenant-context.service.js")
const {
  RequestLanguage,
} = require("../../apps/api/dist/http/request-language.js")
const { storageKey } = require("../../apps/api/dist/files/storage/storage.js")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)
const sha = (body) => createHash("sha256").update(body).digest("hex")

async function signIn(page, account, tenantOrigin, organizationName) {
  await page.goto(tenantOrigin + "/app/")
  await page.getByLabel("邮箱", { exact: true }).fill(account.email)
  await page.getByLabel("密码", { exact: true }).fill(account.password)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  if (organizationName)
    await page
      .getByRole("link", { name: organizationName, exact: true })
      .click()
  await expectUI(
    page.getByRole("link", { name: "文件", exact: true })
  ).toBeVisible()
}

async function selectLocale(page, userName, locale, languageLabel = "语言") {
  await page.getByRole("button", { name: new RegExp(userName) }).click()
  const language = page.getByRole("menuitem", {
    name: languageLabel,
    exact: true,
  })
  await language.focus()
  await language.press("Enter")
  const option = page.getByRole("menuitemradio", { name: locale, exact: true })
  await expectUI(option).toBeVisible()
  await option.focus()
  await option.press("Enter")
}

describe("S9 Files：正式租户产品连接 PostgreSQL 与固定 RustFS", () => {
  const resources = new AsyncDisposableStack()
  let environment, filesConfig, s3, storage, context, page

  beforeAll(async () => {
    try {
      const accessKeyId = randomBytes(12).toString("hex")
      const secretAccessKey = randomBytes(32).toString("hex")
      const container = await new GenericContainer(versions.rustfs.image)
        .withEnvironment({
          RUSTFS_ACCESS_KEY: accessKeyId,
          RUSTFS_SECRET_KEY: secretAccessKey,
          RUSTFS_ADDRESS: ":9000",
          RUSTFS_CONSOLE_ENABLE: "false",
        })
        .withCommand(["/data"])
        .withExposedPorts(9000)
        .withWaitStrategy(
          Wait.forHttp("/health/ready", 9000).forStatusCode(200)
        )
        .withStartupTimeout(120_000)
        .start()
      resources.defer(() => container.stop())
      filesConfig = {
        kind: "s3",
        region: "us-east-1",
        endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
        bucket: `product-files-${randomUUID()}`,
        prefix: "product-read-suite",
        accessKeyId,
        secretAccessKey,
      }
      s3 = new S3Client({
        endpoint: filesConfig.endpoint,
        region: filesConfig.region,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 1,
      })
      resources.defer(() => s3.destroy())
      await s3.send(new CreateBucketCommand({ Bucket: filesConfig.bucket }))
      environment = await startBrowserApplication({ files: filesConfig })
      resources.defer(() => environment.close())
      storage = environment.app.get(FilesRuntime).requireStorage()
    } catch (error) {
      try {
        await resources.disposeAsync()
      } catch (cleanupError) {
        throw new SuppressedError(
          cleanupError,
          error,
          "Files 产品测试启动和资源释放失败"
        )
      }
      throw error
    }
  })

  beforeEach(async () => {
    context = await environment.browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    page = await context.newPage()
  })
  afterEach(async () => context.close())
  afterAll(() => resources.disposeAsync())

  async function fixture({ count = 1, owner: existingOwner } = {}) {
    const owner =
      existingOwner ??
      (await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "文件验收用户" }
      ))
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: owner.headers,
      body: { name: "文件验收组织", slug: `files-product-${randomUUID()}` },
    })
    const tenant = await environment.app
      .get(TenantContextService)
      .resolve(
        owner.headers,
        organization.id,
        { file: ["read"], folder: ["read"] },
        randomUUID(),
        new RequestLanguage("zh-CN")
      )
    const run = (callback) =>
      createTenantRunner(environment.runtime.pool)(tenant, callback, "write")
    const { root } = await run((tx) => fileRepository.ensureWorkspace(tx))
    const at = (area, segments) => ({
      owner: { kind: "organization", id: organization.id },
      area,
      segments,
    })
    await storage.createDirectory(at("files", []))
    const begin = (tx, action, input) =>
      fileRepository.beginOperation(tx, {
        id: randomUUID(),
        action,
        input,
        requestHash: sha(JSON.stringify(input)),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
    // 这里只准备读夹具：目录和文件均经过生产 TenantTx/操作结算，并真实写入私有 RustFS。
    // 页面读取、目录导航、搜索与下载由正式产品控件触发，不在浏览器执行测试 API。
    const folder = async (name, parent = root) => {
      const input = { id: randomUUID(), parentId: parent.id, name }
      const prepared = await run(async (tx) => {
        const { operation } = await begin(tx, "create-folder", input)
        const plan = await fileRepository.prepareFolder(tx, operation.id, input)
        return { operation, ...plan }
      })
      await storage.createDirectory(at("files", prepared.path))
      return run(async (tx) => {
        for (const object of prepared.objects)
          await fileRepository.recordPreparedObject(
            tx,
            prepared.operation.id,
            object.id,
            { bytes: 0, sha256: null, transientBytes: 0 }
          )
        await fileRepository.commitFolder(tx, prepared.operation.id, input)
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return fileRepository.findEntry(tx, input.id)
      })
    }
    const publish = async (
      name,
      body,
      parent = root,
      contentType = "text/plain"
    ) => {
      const fileId = randomUUID(),
        versionId = randomUUID()
      const target = at("files", [...parent.path, name])
      const prepared = await run(async (tx) => {
        const { operation } = await begin(tx, "upload", {
          name,
          parentId: parent.id,
          declaredBytes: body.length,
        })
        await fileRepository.reserveUpload(tx, operation.id, {
          parentId: parent.id,
          name,
          declaredBytes: body.length,
        })
        const [object] = await fileRepository.addObjects(tx, operation.id, [
          {
            entryId: fileId,
            versionId,
            directory: false,
            targetArea: "files",
            targetPath: target.segments,
            expectedBytes: body.length,
          },
        ])
        return { operation, object }
      })
      const facts = await storage.write(
        target,
        (async function* () {
          yield body
        })(),
        body.length
      )
      const entry = await run(async (tx) => {
        await fileRepository.recordPreparedObject(
          tx,
          prepared.operation.id,
          prepared.object.id,
          { ...facts, transientBytes: 0 }
        )
        const entry = await fileRepository.commitUpload(
          tx,
          prepared.operation.id,
          {
            fileId,
            versionId,
            objectId: prepared.object.id,
            parentId: parent.id,
            name,
            contentType,
          }
        )
        await fileRepository.finishOperation(
          tx,
          prepared.operation.id,
          new Date()
        )
        return entry
      })
      return { entry, fileId, versionId, target, body }
    }
    const directory = await folder("合同 2026")
    const empty = await folder("空目录")
    const nested = await publish(
      "内部说明.txt",
      Buffer.from("合同内容 مرحبا\n"),
      directory
    )
    const items = []
    for (let index = 0; index < count; index++)
      items.push(
        await publish(
          `资料 ${String(index).padStart(2, "0")}.txt`,
          Buffer.from(`资料 ${index} 原始字节 مرحبا
`)
        )
      )
    return {
      owner,
      organization,
      root,
      directory,
      empty,
      nested,
      items,
      publish,
      run,
    }
  }

  it("通过真实导航浏览目录、分页与全组织搜索，刷新保持 URL，空目录对应实际 RustFS 标记", async () => {
    const f = await fixture({ count: 25 })
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "文件", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("region", { name: "容量与保留策略", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "资料 00.txt", exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "下一页", exact: true }).click()
    expect(new URL(page.url()).searchParams.get("page")).toBe("2")
    await page.reload()
    await expectUI(page.locator("tbody tr")).toHaveCount(7)
    await page.getByRole("button", { name: "上一页", exact: true }).click()
    await page.getByRole("button", { name: "大小", exact: true }).click()
    expect(new URL(page.url()).searchParams.get("sortBy")).toBe("size")
    const search = page.getByRole("textbox", {
      name: "搜索本组织的文件和文件夹",
      exact: true,
    })
    await search.fill("内部")
    await expectUI(
      page.getByRole("button", { name: "搜索", exact: true })
    ).toBeEnabled()
    await search.press("Enter")
    await expectUI(
      page.getByRole("button", { name: "内部说明.txt", exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get("name")).toBe("内部")
    await page.reload()
    await expectUI(
      page.getByText("在本组织中搜索“内部”", { exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: "合同 2026", exact: true }).click()
    await expectUI(
      page.getByRole("button", { name: "内部说明.txt", exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get("parentId")).toBe(
      f.directory.id
    )
    expect(new URL(page.url()).searchParams.has("name")).toBe(false)
    await page.getByRole("button", { name: "根目录", exact: true }).click()
    await page.getByRole("button", { name: "空目录", exact: true }).click()
    await expectUI(
      page.getByText("此文件夹暂无文件或子文件夹。", { exact: true })
    ).toBeVisible()
    await page.reload()
    await expectUI(
      page.getByText("此文件夹暂无文件或子文件夹。", { exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get("parentId")).toBe(f.empty.id)
    const marker = await s3.send(
      new HeadObjectCommand({
        Bucket: filesConfig.bucket,
        Key:
          filesConfig.prefix +
          "/" +
          storageKey(
            {
              owner: { kind: "organization", id: f.organization.id },
              area: "files",
              segments: ["空目录"],
            },
            true
          ),
      })
    )
    expect(marker.ContentLength).toBe(0)
  })

  it("正式文件详情固定版本 URL，失效版本明确报错，回到所在目录保持组织归属", async () => {
    const f = await fixture()
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    await page.getByRole("button", { name: "资料 00.txt", exact: true }).click()
    await page.getByRole("button", { name: "文件详情", exact: true }).click()
    await expectUI(
      page.getByRole("heading", { name: "资料 00.txt", exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get("versionId")).toBe(
      f.items[0].versionId
    )
    await page.reload()
    await expectUI(
      page.getByRole("region", { name: "所选版本", exact: true })
    ).toContainText("当前版本")
    const invalid = new URL(page.url())
    invalid.searchParams.set("versionId", randomUUID())
    await page.goto(invalid.toString())
    await expectUI(page.getByRole("alert")).toHaveText(
      "此版本已不可用，请从版本记录中明确选择可用版本。"
    )
    await page
      .getByRole("link", { name: "打开所在文件夹", exact: true })
      .click()
    await expectUI(
      page.getByRole("button", { name: "资料 00.txt", exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).searchParams.get("parentId")).toBe(f.root.id)
  })

  it("中英阿语及 RTL 使用同一真实目录与稳定 URL", async () => {
    const f = await fixture()
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    await page.getByRole("button", { name: "合同 2026", exact: true }).click()
    await expectUI(
      page.getByRole("button", { name: "内部说明.txt", exact: true })
    ).toBeVisible()
    const location = page.url()
    await selectLocale(page, f.owner.user.name, "English")
    await expectUI(
      page.getByRole("heading", { name: "Files", exact: true })
    ).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "内部说明.txt", exact: true })
    ).toBeVisible()
    expect(page.url()).toBe(location)
    await selectLocale(page, f.owner.user.name, "العربية", "Language")
    await expectUI(
      page.getByRole("heading", { name: "الملفات", exact: true })
    ).toBeVisible()
    await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
    await expectUI(
      page.getByRole("button", { name: "内部说明.txt", exact: true })
    ).toBeVisible()
    expect(page.url()).toBe(location)
  })

  it("Sheet 从列表预览并恢复焦点，UTF-8 文本 Range 分页不超过 64 KiB，下载核对原始字节与中文文件名", async () => {
    const f = await fixture()
    const body = Buffer.from("a".repeat(65535) + "你مرحبا\n" + "b".repeat(2000))
    const text = await f.publish("分页说明 中文.txt", body)
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    const file = page.getByRole("button", {
      name: text.entry.name,
      exact: true,
    })
    await file.focus()
    const source = page.url()
    const first = page.waitForResponse(
      (response) =>
        response.url().includes(text.versionId + "/content") &&
        response.request().headers().range === "bytes=0-65535"
    )
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog")
    const content = dialog.getByLabel("文本内容", { exact: true })
    await expectUI(content).toHaveText("a".repeat(65535))
    const firstResponse = await first
    expect(firstResponse.status()).toBe(206)
    expect(firstResponse.headers()["content-length"]).toBe("65536")
    expect(firstResponse.headers()["content-range"]).toBe(
      `bytes 0-65535/${body.length}`
    )
    expect(page.url()).toBe(source)
    await expectUI(dialog).toHaveCSS("opacity", "1")
    await page.addScriptTag({
      path: a11yRequire.resolve("axe-core/axe.min.js"),
    })
    expect(
      await page.evaluate(
        async () =>
          (
            await window.axe.run(document.querySelector('[role="dialog"]'), {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
              },
            })
          ).violations
      )
    ).toEqual([])
    const second = page.waitForResponse(
      (response) =>
        response.url().includes(text.versionId + "/content") &&
        response.request().headers().range?.startsWith("bytes=65535-")
    )
    await dialog.getByRole("button", { name: "下一页", exact: true }).click()
    await expectUI(content).toHaveText("你مرحبا\n" + "b".repeat(2000))
    const secondResponse = await second
    expect(secondResponse.status()).toBe(206)
    expect(
      Number(secondResponse.headers()["content-length"])
    ).toBeLessThanOrEqual(65536)
    await dialog.getByRole("button", { name: "上一页", exact: true }).click()
    await expectUI(content).toHaveText("a".repeat(65535))
    const downloaded = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "下载文件", exact: true }).click()
    const download = await downloaded
    expect(download.suggestedFilename()).toBe(text.entry.name)
    expect(await download.failure()).toBeNull()
    const actual = await readFile(await download.path())
    expect(actual).toEqual(body)
    const version = await f.run((tx) =>
      fileRepository.findVersion(tx, text.fileId, text.versionId)
    )
    expect(sha(actual)).toBe(version.version.sha256)
    await page.keyboard.press("Escape")
    await expectUI(dialog).toHaveCount(0)
    await expectUI(file).toBeFocused()
    expect(page.url()).toBe(source)
  })

  it("真实私有图片只使用临时 Blob，关闭撤销资源；HTML 只下载且不执行内嵌内容", async () => {
    const f = await fixture()
    const image = await f.publish(
      "私有图片.png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=",
        "base64"
      ),
      f.root,
      "image/png"
    )
    const html = await f.publish(
      "私有文档.html",
      Buffer.from("<script>window.privateFileExecuted=true</script>"),
      f.root,
      "text/html"
    )
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL)
      window.fileObjectUrls = new Set()
      URL.createObjectURL = (blob) => {
        const url = create(blob)
        window.fileObjectUrls.add(url)
        return url
      }
      URL.revokeObjectURL = (url) => {
        window.fileObjectUrls.delete(url)
        return revoke(url)
      }
    })
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    await page
      .getByRole("button", { name: image.entry.name, exact: true })
      .click()
    const dialog = page.getByRole("dialog")
    const picture = dialog.getByRole("img", {
      name: image.entry.name,
      exact: true,
    })
    await expectUI(picture).toBeVisible()
    await expectUI(picture).toHaveAttribute("src", /^blob:/)
    expect(
      await picture.evaluate(
        (element) => element.complete && element.naturalWidth > 0
      )
    ).toBe(true)
    expect(await page.evaluate(() => window.fileObjectUrls.size)).toBe(1)
    await dialog.getByRole("button", { name: "关闭", exact: true }).click()
    await expectUI(dialog).toHaveCount(0)
    expect(await page.evaluate(() => window.fileObjectUrls.size)).toBe(0)
    await page
      .getByRole("button", { name: html.entry.name, exact: true })
      .click()
    await expectUI(
      dialog.getByText("此文件类型不支持内嵌预览，你可以下载后打开。", {
        exact: true,
      })
    ).toBeVisible()
    await expectUI(dialog.locator("iframe")).toHaveCount(0)
    expect(
      await page.evaluate(() => window.privateFileExecuted)
    ).toBeUndefined()
    const downloaded = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "下载文件", exact: true }).click()
    expect(await readFile(await (await downloaded).path())).toEqual(html.body)
  })

  it("存储读取失败显示正式业务原因，重试恢复内容并保留列表位置", async () => {
    const f = await fixture()
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    const source = page.url()
    await storage.remove(f.items[0].target)
    await page.getByRole("button", { name: "资料 00.txt", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expectUI(dialog).toContainText("资源不存在")
    await expectUI(dialog.getByLabel("文本内容", { exact: true })).toHaveCount(
      0
    )
    await storage.write(
      f.items[0].target,
      (async function* () {
        yield f.items[0].body
      })(),
      f.items[0].body.length
    )
    await dialog.getByRole("button", { name: "重试", exact: true }).click()
    await expectUI(dialog.getByLabel("文本内容", { exact: true })).toHaveText(
      f.items[0].body.toString()
    )
    expect(page.url()).toBe(source)
  })

  it("当前 Cookie 角色撤回 file:read 后清除预览，正式下载拒绝并保留组织边界", async () => {
    const f = await fixture()
    const reader = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator,
      { name: "文件阅读者" }
    )
    const role = await environment.runtime.auth.api.createOrgRole({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        role: "file-reader",
        permission: { file: ["read"], folder: ["read"] },
      },
    })
    await environment.runtime.auth.api.addMember({
      headers: f.owner.headers,
      body: {
        organizationId: f.organization.id,
        userId: reader.user.id,
        role: "file-reader",
      },
    })
    await signIn(page, reader, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    await page.getByRole("button", { name: "资料 00.txt", exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expectUI(dialog.getByLabel("文本内容", { exact: true })).toHaveText(
      f.items[0].body.toString()
    )
    const state = await environment.migrator.query(
      "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
      [f.organization.id]
    )
    const response = await fetch(
      environment.baseURL + "/api/auth/organization/update-role",
      {
        method: "POST",
        headers: {
          cookie: f.owner.cookie,
          origin: environment.tenantOrigin,
          "content-type": "application/json",
          "X-Expected-Authz-Version": String(
            state.rows[0].authorization_version
          ),
        },
        body: JSON.stringify({
          organizationId: f.organization.id,
          roleId: role.roleData.id,
          data: { permission: { folder: ["read"] } },
        }),
      }
    )
    expect(response.status, await response.text()).toBe(200)
    const denied = page.waitForResponse(
      (response) =>
        response.url().includes(f.items[0].versionId + "/content") &&
        response.url().includes("attachment")
    )
    await dialog.getByRole("button", { name: "下载文件", exact: true }).click()
    expect((await denied).status()).toBe(403)
    await expectUI(dialog).toHaveCount(0)
    await expectUI(page.getByText("无权访问", { exact: true })).toBeVisible()
    await expectUI(page.getByLabel("文本内容", { exact: true })).toHaveCount(0)
  })

  it("同一用户切换组织重置目录与搜索，外组织 file/version 定位不能读取", async () => {
    const f = await fixture()
    const other = await fixture({ owner: f.owner })
    await environment.runtime.auth.api.updateOrganization({
      headers: f.owner.headers,
      body: {
        organizationId: other.organization.id,
        data: { name: "第二文件组织" },
      },
    })
    await signIn(page, f.owner, environment.tenantOrigin, "文件验收组织")
    await page.goto(
      environment.tenantOrigin +
        `/app/files/${f.organization.id}?parentId=${f.directory.id}&name=内部`
    )
    await expectUI(
      page.getByRole("button", { name: "内部说明.txt", exact: true })
    ).toBeVisible()
    await page.getByRole("button", { name: /文件验收组织/ }).click()
    await page.getByRole("menuitem", { name: /第二文件组织/ }).click()
    await expectUI(
      page.getByRole("button", { name: "资料 00.txt", exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(
      `/app/files/${other.organization.id}`
    )
    expect(new URL(page.url()).searchParams.has("parentId")).toBe(false)
    expect(new URL(page.url()).searchParams.has("name")).toBe(false)
    await page.goto(
      environment.tenantOrigin +
        `/app/files/${other.organization.id}/entries/${f.items[0].fileId}?versionId=${f.items[0].versionId}`
    )
    await expectUI(page.getByText("资源不存在", { exact: true })).toBeVisible()
    await expectUI(
      page.getByRole("button", { name: "下载文件", exact: true })
    ).toHaveCount(0)
  })

  it.each(["audio", "video", "pdf"])(
    "%s 通过正式受保护 URL 按需读取，预检 Range 不全量加载文件",
    async (kind) => {
      const f = await fixture()
      let body, name, contentType
      if (kind === "audio") {
        body = Buffer.alloc(44 + 16000)
        body.write("RIFF", 0)
        body.writeUInt32LE(body.length - 8, 4)
        body.write("WAVEfmt ", 8)
        body.writeUInt32LE(16, 16)
        body.writeUInt16LE(1, 20)
        body.writeUInt16LE(1, 22)
        body.writeUInt32LE(8000, 24)
        body.writeUInt32LE(16000, 28)
        body.writeUInt16LE(2, 32)
        body.writeUInt16LE(16, 34)
        body.write("data", 36)
        body.writeUInt32LE(16000, 40)
        name = "私有声音.wav"
        contentType = "audio/wav"
      } else if (kind === "video") {
        // 浏览器原生编码仅生成测试字节；内容仍由正式私有存储与 HTTP 入口提供。
        body = Buffer.from(
          await page.evaluate(async () => {
            const canvas = document.createElement("canvas")
            canvas.width = 32
            canvas.height = 32
            const stream = canvas.captureStream(10)
            const recorder = new MediaRecorder(stream, {
              mimeType: "video/webm;codecs=vp8",
            })
            const chunks = []
            recorder.ondataavailable = (event) => chunks.push(event.data)
            const stopped = new Promise((resolve) => {
              recorder.onstop = resolve
            })
            recorder.start()
            const context = canvas.getContext("2d")
            context.fillStyle = "blue"
            context.fillRect(0, 0, 32, 32)
            await new Promise((resolve) => setTimeout(resolve, 150))
            recorder.stop()
            await stopped
            stream.getTracks().forEach((track) => track.stop())
            return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
          })
        )
        name = "私有视频.webm"
        contentType = "video/webm"
      } else {
        const stream = "BT /F1 12 Tf 30 100 Td (Private file preview) Tj ET"
        const objects = [
          "<< /Type /Catalog /Pages 2 0 R >>",
          "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
          `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
          "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]
        let pdf = "%PDF-1.4\n",
          offsets = [0]
        for (const [index, object] of objects.entries()) {
          offsets.push(Buffer.byteLength(pdf))
          pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
        }
        const xref = Buffer.byteLength(pdf)
        pdf +=
          `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
          offsets
            .slice(1)
            .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
            .join("") +
          `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
        body = Buffer.from(pdf)
        name = "私有说明.pdf"
        contentType = "application/pdf"
      }
      const media = await f.publish(name, body, f.root, contentType)
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      const preflight = page.waitForResponse(
        (response) =>
          response.url().includes(media.versionId + "/content") &&
          response.request().headers().range === "bytes=0-0"
      )
      await page.getByRole("button", { name, exact: true }).click()
      const response = await preflight
      expect(response.status()).toBe(206)
      expect(response.headers()["content-length"]).toBe("1")
      expect(response.headers()["content-range"]).toBe(
        `bytes 0-0/${body.length}`
      )
      const selector = kind === "pdf" ? "iframe" : kind
      const viewer = page.getByRole("dialog").locator(selector)
      await expectUI(viewer).toHaveAttribute(
        "src",
        new RegExp(
          `/organizations/${f.organization.id}/files/entries/${media.fileId}/versions/${media.versionId}/content\\?disposition=inline$`
        )
      )
      if (kind !== "pdf") {
        await expect
          .poll(() => viewer.evaluate((element) => element.readyState))
          .toBeGreaterThanOrEqual(1)
        expect(
          await viewer.evaluate((element) => element.error?.message)
        ).toBeUndefined()
      } else await expectUI(viewer).toBeVisible()
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click()
      await expectUI(viewer).toHaveCount(0)
    }
  )

  it("关闭正在读取的 Sheet 会取消真实请求，迟到响应不能创建私有 Blob 或重新打开预览", async () => {
    const f = await fixture()
    const image = await f.publish(
      "等待读取.png",
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=",
        "base64"
      ),
      f.root,
      "image/png"
    )
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL)
      window.fileObjectUrls = []
      URL.createObjectURL = (blob) => {
        const url = create(blob)
        window.fileObjectUrls.push(url)
        return url
      }
    })
    await signIn(page, f.owner, environment.tenantOrigin)
    await page.getByRole("link", { name: "文件", exact: true }).click()
    const received = Promise.withResolvers(),
      release = Promise.withResolvers()
    const matches = (request) =>
      request.url().includes(image.versionId + "/content")
    await page.route(
      `**/versions/${image.versionId}/content?disposition=inline`,
      async (route) => {
        // 只暂缓真实服务端响应以检验取消时序，仍由生产 API 读取 RustFS 原始字节。
        const response = await route.fetch()
        received.resolve(response.status())
        await release.promise
        await route.fulfill({ response })
      },
      { times: 1 }
    )
    try {
      await page
        .getByRole("button", { name: image.entry.name, exact: true })
        .click()
      expect(await received.promise).toBe(200)
      const canceled = page.waitForEvent("requestfailed", matches)
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click()
      expect((await canceled).failure().errorText).toContain("ERR_ABORTED")
    } finally {
      release.resolve()
      await page.unrouteAll({ behavior: "wait" })
    }
    await expectUI(page.getByRole("dialog")).toHaveCount(0)
    expect(await page.evaluate(() => window.fileObjectUrls)).toEqual([])
  })

  it.each([
    {
      name: "空文本.txt",
      contentType: "text/plain",
      body: Buffer.alloc(0),
      expected: "此文件没有文本内容。",
    },
    {
      name: "私有配置.json",
      contentType: "application/json",
      body: Buffer.from('{"名称":"原始 JSON مرحبا","count":1}\n'),
      expected: '{"名称":"原始 JSON مرحبا","count":1}',
    },
  ])(
    "$name 的正式预览与下载保持原始字节，空文件不发送无效 Range",
    async (input) => {
      const f = await fixture()
      const content = await f.publish(
        input.name,
        input.body,
        f.root,
        input.contentType
      )
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      const loaded = page.waitForResponse(
        (response) =>
          response.url().includes(content.versionId + "/content") &&
          response.url().includes("inline")
      )
      await page.getByRole("button", { name: input.name, exact: true }).click()
      const dialog = page.getByRole("dialog")
      await expectUI(dialog.getByLabel("文本内容", { exact: true })).toHaveText(
        input.expected
      )
      const response = await loaded
      expect(response.status()).toBe(input.body.length ? 206 : 200)
      expect(response.headers()["content-length"]).toBe(
        String(input.body.length)
      )
      expect(response.request().headers().range).toBe(
        input.body.length ? `bytes=0-${input.body.length - 1}` : undefined
      )
      const downloaded = page.waitForEvent("download")
      await dialog
        .getByRole("button", { name: "下载文件", exact: true })
        .click()
      expect(await readFile(await (await downloaded).path())).toEqual(
        input.body
      )
    }
  )
})
