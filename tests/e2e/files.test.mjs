import { containerHostURL } from "../setup/container-host.mjs"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
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
import {
  CreateFolderSchema,
  FileOperationResponseSchema,
} from "../../packages/contracts/dist/index.js"
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

async function startReadBackend(kind, resources) {
  if (kind === "RustFS") {
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
      .withWaitStrategy(Wait.forHttp("/health/ready", 9000).forStatusCode(200))
      .withStartupTimeout(120_000)
      .start()
    resources.defer(() => container.stop())
    const filesConfig = {
      kind: "s3",
      region: "us-east-1",
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      bucket: `product-files-${randomUUID()}`,
      prefix: "product-read-suite",
      accessKeyId,
      secretAccessKey,
    }
    const s3 = new S3Client({
      endpoint: filesConfig.endpoint,
      region: filesConfig.region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 1,
    })
    resources.defer(() => s3.destroy())
    await s3.send(new CreateBucketCommand({ Bucket: filesConfig.bucket }))
    const environment = await startBrowserApplication({ files: filesConfig })
    resources.defer(() => environment.close())
    const storage = environment.app.get(FilesRuntime).requireStorage()
    return {
      environment,
      storage,
      assertDirectory: async (address) => {
        const marker = await s3.send(
          new HeadObjectCommand({
            Bucket: filesConfig.bucket,
            Key: filesConfig.prefix + "/" + storageKey(address, true),
          })
        )
        expect(marker.ContentLength).toBe(0)
      },
    }
  }
  let container
  const environment = await startBrowserApplication({
    startApiServer: async (runtime) => {
      const config = {
        ...runtime.config,
        databaseURL: await containerHostURL(runtime.config.databaseURL),
        redisURL: await containerHostURL(runtime.config.redisURL),
        files: { kind: "local", root: "/tmp/product-file-reads" },
      }
      container = await new GenericContainer(versions.nodeImage)
        .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
        .withWorkingDir("/app")
        .withEnvironment({ FILES_READ_CONFIG: JSON.stringify(config) })
        .withExposedPorts(3000)
        .withCommand([
          "node",
          "-e",
          `const {mkdir}=require('node:fs/promises');const {createApplication}=require('./apps/api/dist/create-application.js');(async()=>{const config=JSON.parse(process.env.FILES_READ_CONFIG);await mkdir(config.files.root,{recursive:true,mode:0o700});const app=await createApplication(config,{logger:false});await app.listen(3000,'0.0.0.0');console.log('FILES_READ_READY');process.once('SIGTERM',()=>app.close().then(()=>process.exit(0)));})().catch(error=>{console.error(error.code??error.message);process.exit(1)});`,
        ])
        .withWaitStrategy(Wait.forLogMessage("FILES_READ_READY"))
        .start()
      return {
        baseURL: `http://${container.getHost()}:${container.getMappedPort(3000)}`,
        close: () => container.stop(),
      }
    },
  })
  resources.defer(() => environment.close())
  const physical = async (action, input) => {
    // 大文本通过 Docker 文件传输准备，避免操作系统 argv 上限改变同一组浏览器验收数据。
    const path = `/tmp/file-read-seed-${randomUUID()}.json`
    await container.copyContentToContainer([
      { target: path, content: JSON.stringify({ action, ...input }) },
    ])
    const response = await container.exec([
      "node",
      "-e",
      `const {readFile,rm,stat}=require('node:fs/promises');const {join}=require('node:path');const {createFileStorage,storageKey}=require('./apps/api/dist/files/storage/storage.js');(async()=>{const path=process.argv[1];try{const input=JSON.parse(await readFile(path,'utf8')),config=JSON.parse(process.env.FILES_READ_CONFIG).files;let result;if(input.action==='directory'){result=(await stat(join(config.root,storageKey(input.address,true)))).isDirectory()}else{const storage=await createFileStorage(config);if(input.action==='write'){const body=Buffer.from(input.body,'base64');result=await storage.write(input.address,(async function*(){yield body})(),input.declaredBytes)}else if(input.action==='createDirectory'){result=await storage.createDirectory(input.address)}else if(input.action==='remove'){result=await storage.remove(input.address)}else throw new Error('Unknown seed operation')}console.log(JSON.stringify({result}))}finally{await rm(path)}})().catch(error=>{console.error(error.code??error.message);process.exit(1)});`,
      path,
    ])
    if (response.exitCode !== 0)
      throw new Error("Local file read fixture failed: " + response.output)
    return JSON.parse(response.output.trim()).result
  }
  return {
    environment,
    storage: {
      createDirectory: (address) => physical("createDirectory", { address }),
      remove: (address) => physical("remove", { address }),
      write: async (address, stream, declaredBytes) => {
        const chunks = []
        for await (const chunk of stream) chunks.push(chunk)
        return physical("write", {
          address,
          body: Buffer.concat(chunks).toString("base64"),
          declaredBytes,
        })
      },
    },
    assertDirectory: async (address) =>
      expect(await physical("directory", { address })).toBe(true),
  }
}

describe.each(["RustFS", "Local"])(
  "S9 %s：正式文件读取与文件夹创建产品链路",
  (kind) => {
    const resources = new AsyncDisposableStack()
    let environment, storage, assertDirectory, context, page
    beforeAll(async () => {
      try {
        ;({ environment, storage, assertDirectory } = await startReadBackend(
          kind,
          resources
        ))
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
        extraHTTPHeaders: {
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
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
      const organization =
        await environment.runtime.auth.api.createOrganization({
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
      // 这里只准备读夹具：目录和文件均经过生产 TenantTx/操作结算，并真实写入所选私有存储。
      // 页面读取、目录导航、搜索与下载由正式产品控件触发，不在浏览器执行测试 API。
      const folder = async (name, parent = root) => {
        const input = { id: randomUUID(), parentId: parent.id, name }
        const prepared = await run(async (tx) => {
          const { operation } = await begin(tx, "create-folder", input)
          const plan = await fileRepository.prepareFolder(
            tx,
            operation.id,
            input
          )
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

    it("通过真实导航浏览目录、分页与全组织搜索，刷新保持 URL，空目录对应实际存储目录", async () => {
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
      await assertEmptyFolderMarker(f, ["空目录"])
    })

    it("正式文件详情固定版本 URL，失效版本明确报错，回到所在目录保持组织归属", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await page
        .getByRole("button", { name: "资料 00.txt", exact: true })
        .click()
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
      const body = Buffer.from(
        "a".repeat(65535) + "你مرحبا\n" + "b".repeat(2000)
      )
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
      await dialog
        .getByRole("button", { name: "下载文件", exact: true })
        .click()
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
      await dialog
        .getByRole("button", { name: "下载文件", exact: true })
        .click()
      expect(await readFile(await (await downloaded).path())).toEqual(html.body)
    })

    it("存储读取失败显示正式业务原因，重试恢复内容并保留列表位置", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      const source = page.url()
      await storage.remove(f.items[0].target)
      await page
        .getByRole("button", { name: "资料 00.txt", exact: true })
        .click()
      const dialog = page.getByRole("dialog")
      await expectUI(dialog).toContainText("资源不存在")
      await expectUI(
        dialog.getByLabel("文本内容", { exact: true })
      ).toHaveCount(0)
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
      await page
        .getByRole("button", { name: "资料 00.txt", exact: true })
        .click()
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
      await dialog
        .getByRole("button", { name: "下载文件", exact: true })
        .click()
      expect((await denied).status()).toBe(403)
      await expectUI(dialog).toHaveCount(0)
      await expectUI(page.getByText("无权访问", { exact: true })).toBeVisible()
      await expectUI(page.getByLabel("文本内容", { exact: true })).toHaveCount(
        0
      )
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
      await expectUI(
        page.getByText("资源不存在", { exact: true })
      ).toBeVisible()
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
        await page
          .getByRole("button", { name: input.name, exact: true })
          .click()
        const dialog = page.getByRole("dialog")
        await expectUI(
          dialog.getByLabel("文本内容", { exact: true })
        ).toHaveText(input.expected)
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

    const folderWrites = (organizationId) => (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname ===
        `/api/v1/organizations/${organizationId}/files/folders`

    async function openCreation(name) {
      await page
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      const dialog = page.getByRole("dialog", {
        name: "创建文件夹",
        exact: true,
      })
      await dialog
        .getByRole("textbox", { name: "文件夹名称", exact: true })
        .fill(name)
      return dialog
    }

    async function assertEmptyFolderMarker(f, segments) {
      await assertDirectory({
        owner: { kind: "organization", id: f.organization.id },
        area: "files",
        segments,
      })
    }

    it("正式创建空文件夹写入当前目录与实际存储，关闭恢复焦点，刷新保持新层级", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await page.getByRole("button", { name: "合同 2026", exact: true }).click()
      const location = page.url()
      const dialog = await openCreation("  新合同 目录  ")
      await expectUI(dialog).toContainText("在“合同 2026”中创建一个空文件夹。")
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
      const submitted = page.waitForResponse((response) =>
        folderWrites(f.organization.id)(response.request())
      )
      await dialog
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      const response = await submitted
      expect(response.status()).toBe(200)
      const input = CreateFolderSchema.parse(response.request().postDataJSON())
      const receipt = FileOperationResponseSchema.parse(await response.json())
      expect(input).toMatchObject({
        parentId: f.directory.id,
        name: "新合同 目录",
      })
      expect(receipt).toMatchObject({
        id: input.operationId,
        phase: "completed",
      })
      const created = await f.run((tx) =>
        fileRepository.findEntry(tx, receipt.result.entryId)
      )
      expect(created).toMatchObject({
        parentId: f.directory.id,
        name: "新合同 目录",
        path: ["合同 2026", "新合同 目录"],
      })
      await expectUI(dialog).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: "创建文件夹", exact: true })
      ).toBeFocused()
      expect(page.url()).toBe(location)
      await expectUI(
        page.getByRole("button", { name: "新合同 目录", exact: true })
      ).toBeVisible()
      await assertEmptyFolderMarker(f, created.path)
      await page
        .getByRole("button", { name: "新合同 目录", exact: true })
        .click()
      await expectUI(
        page.getByText("此文件夹暂无文件或子文件夹。", { exact: true })
      ).toBeVisible()
      await page.reload()
      await expectUI(
        page.getByText("此文件夹暂无文件或子文件夹。", { exact: true })
      ).toBeVisible()
      expect(new URL(page.url()).searchParams.get("parentId")).toBe(created.id)
    })

    it("中文目录名称按246 UTF-8字节校验，超限保留原稿并不发写请求", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await page.getByRole("button", { name: "空目录", exact: true }).click()
      const writes = []
      page.on("request", (request) => {
        if (folderWrites(f.organization.id)(request))
          writes.push(request.postDataJSON())
      })
      const name = "你".repeat(82)
      const dialog = await openCreation(name + "你")
      const input = dialog.getByRole("textbox", {
        name: "文件夹名称",
        exact: true,
      })
      await dialog
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      await expectUI(input).toHaveValue(name + "你")
      await expectUI(input).toHaveAttribute("aria-invalid", "true")
      await expectUI(dialog).toContainText("文件夹名称过长，请缩短名称。")
      expect(writes).toHaveLength(0)
      await input.fill(name)
      const submitted = page.waitForResponse((response) =>
        folderWrites(f.organization.id)(response.request())
      )
      await dialog
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      const response = await submitted
      expect(response.status()).toBe(200)
      expect(writes).toHaveLength(1)
      expect(Buffer.byteLength(writes[0].name)).toBe(246)
      expect(writes[0].parentId).toBe(f.empty.id)
      await expectUI(
        page.getByRole("button", { name, exact: true })
      ).toBeVisible()
      await assertEmptyFolderMarker(f, ["空目录", name])
    })

    it("同级冲突保留名称与失败操作事实，明确重新创建才产生新身份", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      const dialog = await openCreation("空目录")
      const firstResponse = page.waitForResponse((response) =>
        folderWrites(f.organization.id)(response.request())
      )
      await dialog
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      const rejected = await firstResponse
      expect(rejected.status()).toBe(409)
      expect(await rejected.json()).toMatchObject({
        code: "FILE_NAME_CONFLICT",
      })
      const first = CreateFolderSchema.parse(rejected.request().postDataJSON())
      const failed = await f.run((tx) =>
        fileRepository.findOperation(tx, first.operationId)
      )
      expect(failed).toMatchObject({
        phase: "failed",
        errorCode: "FILE_NAME_CONFLICT",
        committedAt: null,
      })
      await expectUI(
        dialog.getByRole("textbox", { name: "文件夹名称", exact: true })
      ).toHaveValue("空目录")
      await expectUI(dialog.getByRole("alert")).toContainText("名称")
      await dialog
        .getByRole("textbox", { name: "文件夹名称", exact: true })
        .fill("明确新建目录")
      const submitted = page.waitForResponse((response) =>
        folderWrites(f.organization.id)(response.request())
      )
      await dialog
        .getByRole("button", { name: "重新创建", exact: true })
        .click()
      const completed = await submitted
      expect(completed.status()).toBe(200)
      const second = CreateFolderSchema.parse(
        completed.request().postDataJSON()
      )
      expect(second.operationId).not.toBe(first.operationId)
      expect(second.parentId).toBe(first.parentId)
      const unchanged = await f.run((tx) =>
        fileRepository.findOperation(tx, first.operationId)
      )
      expect(unchanged).toMatchObject({
        phase: "failed",
        errorCode: "FILE_NAME_CONFLICT",
        committedAt: null,
      })
      await expectUI(
        page.getByRole("button", { name: "明确新建目录", exact: true })
      ).toBeVisible()
      await assertEmptyFolderMarker(f, ["明确新建目录"])
    })

    it("丢失真实创建响应后查询原UUID，不重复写入且读取正式完成收据", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      const writes = [],
        reads = []
      page.on("request", (request) => {
        if (folderWrites(f.organization.id)(request))
          writes.push(request.postDataJSON())
        if (
          request.method() === "GET" &&
          new URL(request.url()).pathname.startsWith(
            `/api/v1/organizations/${f.organization.id}/files/operations/`
          )
        )
          reads.push(new URL(request.url()).pathname.split("/").at(-1))
      })
      await page.route(
        `**/organizations/${f.organization.id}/files/folders`,
        async (route) => {
          // 操作已由真实服务执行；只丢失回程响应，验证客户端按原身份查询而不再次写入。
          const response = await route.fetch()
          expect(response.status()).toBe(200)
          await route.abort("failed")
        },
        { times: 1 }
      )
      const dialog = await openCreation("已完成但未收到响应")
      await dialog
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      await expectUI(dialog).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: "已完成但未收到响应", exact: true })
      ).toBeVisible()
      expect(writes).toHaveLength(1)
      expect(reads).toEqual([writes[0].operationId])
      const facts = await f.run((tx) =>
        fileRepository.findOperation(tx, writes[0].operationId)
      )
      expect(facts.phase).toBe("completed")
      await assertEmptyFolderMarker(f, ["已完成但未收到响应"])
    })

    it("真实创建请求待响应时锁定关闭与键盘重复提交，只发布一个文件夹", async () => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      const received = Promise.withResolvers(),
        release = Promise.withResolvers()
      const writes = []
      page.on("request", (request) => {
        if (folderWrites(f.organization.id)(request))
          writes.push(request.postDataJSON())
      })
      await page.route(
        `**/organizations/${f.organization.id}/files/folders`,
        async (route) => {
          const response = await route.fetch()
          received.resolve(response.status())
          await release.promise
          await route.fulfill({ response })
        },
        { times: 1 }
      )
      const dialog = await openCreation("仅一次创建")
      try {
        await dialog
          .getByRole("button", { name: "创建文件夹", exact: true })
          .click()
        expect(await received.promise).toBe(200)
        await expectUI(
          dialog.getByRole("textbox", { name: "文件夹名称", exact: true })
        ).toBeDisabled()
        await expectUI(
          dialog.getByRole("button", { name: "取消", exact: true })
        ).toBeDisabled()
        await page.keyboard.press("Escape")
        await page.keyboard.press("Enter")
        await expectUI(dialog).toBeVisible()
        expect(writes).toHaveLength(1)
      } finally {
        release.resolve()
        await page.unrouteAll({ behavior: "wait" })
      }
      await expectUI(dialog).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: "仅一次创建", exact: true })
      ).toBeVisible()
      expect(writes).toHaveLength(1)
    })

    it("内置member只读成员可以浏览文件，创建能力按真实权限隐藏", async () => {
      const f = await fixture()
      const reader = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "目录只读成员" }
      )
      await environment.runtime.auth.api.addMember({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          userId: reader.user.id,
          role: "member",
        },
      })
      await signIn(page, reader, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(
        page.getByRole("button", { name: "资料 00.txt", exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "创建文件夹", exact: true })
      ).toHaveCount(0)
      await page.getByRole("button", { name: "空目录", exact: true }).click()
      await expectUI(
        page.getByText("此文件夹暂无文件或子文件夹。", { exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "创建文件夹", exact: true })
      ).toHaveCount(0)
    })

    it.each([
      {
        locale: "English",
        create: "Create folder",
        field: "Folder name",
        name: "English directory",
      },
      {
        locale: "العربية",
        create: "إنشاء مجلد",
        field: "اسم المجلد",
        name: "مجلد عربي",
      },
    ])("$locale 的真实创建使用键盘与原层级，阿语保持RTL", async (input) => {
      const f = await fixture()
      await signIn(page, f.owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await page.getByRole("button", { name: "合同 2026", exact: true }).click()
      await selectLocale(page, f.owner.user.name, input.locale)
      if (input.locale === "العربية")
        await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
      const location = page.url()
      await page
        .getByRole("button", { name: input.create, exact: true })
        .click()
      const dialog = page.getByRole("dialog", {
        name: input.create,
        exact: true,
      })
      const field = dialog.getByRole("textbox", {
        name: input.field,
        exact: true,
      })
      await field.fill(input.name)
      const submitted = page.waitForResponse((response) =>
        folderWrites(f.organization.id)(response.request())
      )
      await field.press("Enter")
      const response = await submitted
      expect(response.status()).toBe(200)
      expect(response.request().postDataJSON().parentId).toBe(f.directory.id)
      await expectUI(dialog).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: input.name, exact: true })
      ).toBeVisible()
      expect(page.url()).toBe(location)
      await assertEmptyFolderMarker(f, ["合同 2026", input.name])
    })
  }
)

async function startUploadBackend(kind, resources) {
  if (kind === "RustFS") {
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
      .withWaitStrategy(Wait.forHttp("/health/ready", 9000).forStatusCode(200))
      .start()
    resources.defer(() => container.stop())
    const config = {
      kind: "s3",
      region: "us-east-1",
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      bucket: `upload-product-${randomUUID()}`,
      prefix: "product-uploads",
      accessKeyId,
      secretAccessKey,
    }
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 1,
    })
    resources.defer(() => client.destroy())
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
    const environment = await startBrowserApplication({ files: config })
    resources.defer(() => environment.close())
    const storage = environment.app.get(FilesRuntime).requireStorage()
    return {
      ...environment,
      physicalRead: async (address) => {
        const read = await storage.open(address)
        const chunks = []
        for await (const chunk of read.body) chunks.push(chunk)
        return Buffer.concat(chunks)
      },
    }
  }
  let container
  const environment = await startBrowserApplication({
    startApiServer: async (runtime) => {
      const config = {
        ...runtime.config,
        databaseURL: await containerHostURL(runtime.config.databaseURL),
        redisURL: await containerHostURL(runtime.config.redisURL),
        files: { kind: "local", root: "/tmp/product-uploads" },
      }
      // 与正式 Local HTTP fixture 相同的生产 createApplication 和 Linux 策略；不定义任何测试业务路由。
      container = await new GenericContainer(versions.nodeImage)
        .withBindMounts([{ source: resolve("."), target: "/app", mode: "ro" }])
        .withWorkingDir("/app")
        .withEnvironment({ FILES_TEST_CONFIG: JSON.stringify(config) })
        .withExposedPorts(3000)
        .withCommand([
          "node",
          "-e",
          `const {mkdir}=require('node:fs/promises');const {createApplication}=require('./apps/api/dist/create-application.js');const config=JSON.parse(process.env.FILES_TEST_CONFIG);let app;(async()=>{await mkdir(config.files.root,{recursive:true,mode:0o700});app=await createApplication(config,{logger:false});await app.listen(3000,'0.0.0.0');console.log('FILES_PRODUCT_LINUX_READY');process.on('SIGTERM',()=>app.close().then(()=>process.exit(0)));})().catch(async error=>{console.error(error.code??error.message);await app?.close();process.exit(1)});`,
        ])
        .withWaitStrategy(Wait.forLogMessage("FILES_PRODUCT_LINUX_READY"))
        .start()
      return {
        baseURL: `http://${container.getHost()}:${container.getMappedPort(3000)}`,
        close: () => container.stop(),
      }
    },
  })
  resources.defer(() => environment.close())
  return {
    ...environment,
    physicalRead: async (address) => {
      const response = await container.exec([
        "node",
        "-e",
        `const {createApplication}=require('./apps/api/dist/create-application.js');const {FilesRuntime}=require('./apps/api/dist/files/files-runtime.js');(async()=>{const app=await createApplication(JSON.parse(process.env.FILES_TEST_CONFIG),{logger:false});try{await app.init();const read=await app.get(FilesRuntime).requireStorage().open(JSON.parse(process.argv[1]));const chunks=[];for await(const chunk of read.body)chunks.push(chunk);console.log(Buffer.concat(chunks).toString('base64'));}finally{await app.close()}})().catch(error=>{console.error(error.code??error.message);process.exit(1)});`,
        JSON.stringify(address),
      ])
      if (response.exitCode !== 0)
        throw new Error("Local physical read failed: " + response.output)
      return Buffer.from(response.output.trim(), "base64")
    },
  }
}

describe.each(["RustFS", "Local"])(
  "S9 %s：正式组织上传与覆盖产品链路",
  (kind) => {
    const resources = new AsyncDisposableStack()
    let environment, context, page
    beforeAll(async () => {
      try {
        environment = await startUploadBackend(kind, resources)
      } catch (error) {
        await resources.disposeAsync()
        throw error
      }
    })
    afterAll(() => resources.disposeAsync())
    beforeEach(async () => {
      context = await environment.browser.newContext({
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: {
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
      })
      page = await context.newPage()
    })
    afterEach(() => context.close())
    async function fixture() {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "上传验收用户" }
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "上传验收组织", slug: `uploads-${randomUUID()}` },
        })
      const tenant = await environment.app
        .get(TenantContextService)
        .resolve(
          owner.headers,
          organization.id,
          { file: ["read", "upload", "update"], folder: ["read", "create"] },
          randomUUID(),
          new RequestLanguage("zh-CN")
        )
      const run = (callback) =>
        createTenantRunner(environment.runtime.pool)(tenant, callback, "write")
      const { root } = await run((tx) => fileRepository.ensureWorkspace(tx))
      await signIn(page, owner, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(
        page.getByRole("button", { name: "上传文件", exact: true })
      ).toBeVisible()
      return { owner, organization, root, run }
    }
    const writes =
      (organizationId, action = "uploads") =>
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname ===
          `/api/v1/organizations/${organizationId}/files/${action}`
    const queue = () =>
      page.getByRole("region", { name: "上传任务", exact: true })
    async function selection(
      payload,
      { trigger = "上传文件", field = "选择文件", start = "开始上传" } = {}
    ) {
      await page.getByRole("button", { name: trigger, exact: true }).click()
      const dialog = page.getByRole("dialog", { name: trigger, exact: true })
      const input = dialog.getByLabel(field, { exact: true })
      await input.focus()
      await input.setInputFiles(payload)
      return {
        dialog,
        start: () =>
          dialog.getByRole("button", { name: start, exact: true }).click(),
      }
    }
    async function upload(
      f,
      name,
      buffer = Buffer.from("原始内容 مرحبا"),
      mimeType = "text/plain"
    ) {
      const form = await selection({ name, mimeType, buffer })
      const submitted = page.waitForResponse(writes(f.organization.id))
      await form.start()
      const response = await submitted
      expect(response.status()).toBe(200)
      const operation = FileOperationResponseSchema.parse(await response.json())
      await expectUI(form.dialog).toHaveCount(0)
      await expectUI(
        queue().getByRole("listitem", { name, exact: true }).getByRole("status")
      ).toHaveText("上传完成")
      return operation
    }
    async function createFolder(name) {
      await page
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      const dialog = page.getByRole("dialog", {
        name: "创建文件夹",
        exact: true,
      })
      await dialog.getByLabel("文件夹名称", { exact: true }).fill(name)
      await dialog
        .getByRole("button", { name: "创建文件夹", exact: true })
        .click()
      await expectUI(dialog).toHaveCount(0)
      await page
        .locator("tbody")
        .getByRole("button", { name, exact: true })
        .click()
    }
    async function records(f) {
      return page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        `enterprise-admin:file-uploads:${JSON.stringify([f.owner.user.id, f.organization.id])}`
      )
    }
    async function journal(f, id) {
      const result = await environment.observer.query(
        "SELECT phase, error_code, committed_at, result FROM public.file_operations WHERE organization_id=$1 AND id=$2",
        [f.organization.id, id]
      )
      return result.rows[0]
    }
    async function physical(f, name, parents = []) {
      return environment.physicalRead({
        owner: { kind: "organization", id: f.organization.id },
        area: "files",
        segments: [...parents, name],
      })
    }

    it("真实目录中文名称、多文件与0字节上传，正式完成后刷新列表和实际容量", async () => {
      const f = await fixture()
      await createFolder("上传目录")
      const location = page.url()
      const body = Buffer.from("原始字节 مرحبا\n")
      const form = await selection([
        { name: "中文.txt", mimeType: "text/plain", buffer: body },
        { name: "空文件.txt", mimeType: "text/plain", buffer: Buffer.alloc(0) },
      ])
      const responses = []
      page.on("response", (response) => {
        if (writes(f.organization.id)(response)) responses.push(response)
      })
      await form.start()
      await expectUI(queue().getByRole("status")).toHaveText([
        "上传完成",
        "上传完成",
      ])
      expect(responses).toHaveLength(2)
      const completed = await Promise.all(
        responses.map((response) => response.json())
      )
      expect(
        completed.every((operation) => operation.phase === "completed")
      ).toBe(true)
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "中文.txt", exact: true })
      ).toBeVisible()
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "空文件.txt", exact: true })
      ).toBeVisible()
      expect(page.url()).toBe(location)
      expect(await physical(f, "中文.txt", ["上传目录"])).toEqual(body)
      expect(await physical(f, "空文件.txt", ["上传目录"])).toEqual(
        Buffer.alloc(0)
      )
      const usage = await environment.observer.query(
        "SELECT used_bytes, reserved_bytes, transient_bytes FROM public.file_storage_usage WHERE organization_id=$1",
        [f.organization.id]
      )
      expect(Number(usage.rows[0].used_bytes)).toBe(body.length)
      expect(Number(usage.rows[0].reserved_bytes)).toBe(0)
      expect(Number(usage.rows[0].transient_bytes)).toBe(0)
      const saved = await records(f)
      for (const record of saved)
        expect(Object.keys(record).sort()).toEqual([
          "action",
          "createdAt",
          "id",
          "phase",
          "submitted",
          "updatedAt",
        ])
      await page.reload()
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "中文.txt", exact: true })
      ).toBeVisible()
      expect(page.url()).toBe(location)
    })

    it("同名409不自动覆盖，失败原File保留；明确重新上传与改名产生新UUID", async () => {
      const f = await fixture()
      const original = await upload(f, "同名.txt", Buffer.from("first"))
      const form = await selection({
        name: "同名.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("second"),
      })
      const response = page.waitForResponse(writes(f.organization.id))
      await form.start()
      expect((await response).status()).toBe(409)
      const jobs = queue().getByRole("listitem", {
        name: "同名.txt",
        exact: true,
      })
      const failed = jobs.filter({
        has: page.getByRole("button", { name: "重新上传", exact: true }),
      })
      await expectUI(failed.getByRole("status")).toHaveText("上传未完成")
      const failedId = (await records(f)).at(-1).id
      expect(await journal(f, failedId)).toMatchObject({
        phase: "failed",
        error_code: "FILE_NAME_CONFLICT",
        committed_at: null,
      })
      expect(await physical(f, "同名.txt")).toEqual(Buffer.from("first"))
      await failed
        .getByRole("button", { name: "重新上传", exact: true })
        .click()
      const retry = page.getByRole("dialog", { name: "上传文件", exact: true })
      await expectUI(
        retry.getByRole("textbox", { name: "上传后的文件名", exact: true })
      ).toHaveValue("同名.txt")
      await retry
        .getByRole("textbox", { name: "上传后的文件名", exact: true })
        .fill("新名称.txt")
      const accepted = page.waitForResponse(writes(f.organization.id))
      await retry.getByRole("button", { name: "开始上传", exact: true }).click()
      const next = await (await accepted).json()
      expect(next.id).not.toBe(failedId)
      await expectUI(
        queue()
          .getByRole("listitem", { name: "新名称.txt", exact: true })
          .getByRole("status")
      ).toHaveText("上传完成")
      expect(await physical(f, "新名称.txt")).toEqual(Buffer.from("second"))
      const current = await f.run((tx) =>
        fileRepository.findEntry(tx, original.result.entryId)
      )
      expect(current.currentVersionId).toBe(original.result.versionId)
    })

    it("选择文件后明确确认覆盖，新增版本且原固定版本引用保持原字节", async () => {
      const f = await fixture()
      const original = await upload(f, "版本.txt", Buffer.from("first version"))
      await page
        .locator("tbody tr")
        .filter({
          has: page.getByRole("button", { name: "版本.txt", exact: true }),
        })
        .getByRole("checkbox")
        .check()
      const form = await selection(
        {
          name: "replacement.bin",
          mimeType: "application/octet-stream",
          buffer: Buffer.from([0, 255, 4, 8]),
        },
        { trigger: "覆盖文件", field: "选择文件", start: "确认覆盖" }
      )
      await expectUI(
        form.dialog.getByText(/现有引用仍指向原版本/)
      ).toBeVisible()
      expect(await records(f)).toHaveLength(1)
      const response = page.waitForResponse(
        writes(
          f.organization.id,
          `entries/${original.result.entryId}/overwrite`
        )
      )
      await form.start()
      const overwritten = FileOperationResponseSchema.parse(
        await (await response).json()
      )
      expect(overwritten.result.entryId).toBe(original.result.entryId)
      expect(overwritten.result.versionId).not.toBe(original.result.versionId)
      await expectUI(queue().getByRole("status")).toHaveText([
        "上传完成",
        "上传完成",
      ])
      expect(await physical(f, "版本.txt")).toEqual(Buffer.from([0, 255, 4, 8]))
      await queue()
        .getByRole("listitem", { name: "版本.txt", exact: true })
        .first()
        .getByRole("button", { name: "查看所上传版本", exact: true })
        .click()
      expect(new URL(page.url()).searchParams.get("versionId")).toBe(
        original.result.versionId
      )
      await page.getByRole("button", { name: "预览", exact: true }).click()
      await expectUI(
        page
          .getByRole("dialog")
          .getByRole("region", { name: "文本内容", exact: true })
      ).toHaveText("first version")
    })

    it("另一会话先覆盖后旧revision被拒绝，原File保留且明确重新确认使用当前revision", async () => {
      const f = await fixture()
      const original = await upload(f, "并发版本.txt", Buffer.from("original"))
      const row = page.locator("tbody tr").filter({
        has: page.getByRole("button", { name: "并发版本.txt", exact: true }),
      })
      await row.getByRole("checkbox").check()
      const stale = await selection(
        {
          name: "mine.bin",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("my replacement"),
        },
        { trigger: "覆盖文件", start: "确认覆盖" }
      )
      const other = await environment.browser.newContext({
        viewport: { width: 1280, height: 800 },
        extraHTTPHeaders: {
          "x-real-ip": `10.${[...randomBytes(3)].join(".")}`,
        },
      })
      try {
        const otherPage = await other.newPage()
        await signIn(otherPage, f.owner, environment.tenantOrigin)
        await otherPage.getByRole("link", { name: "文件", exact: true }).click()
        await otherPage
          .locator("tbody tr")
          .filter({
            has: otherPage.getByRole("button", {
              name: "并发版本.txt",
              exact: true,
            }),
          })
          .getByRole("checkbox")
          .check()
        await otherPage
          .getByRole("button", { name: "覆盖文件", exact: true })
          .click()
        const dialog = otherPage.getByRole("dialog", {
          name: "覆盖文件",
          exact: true,
        })
        const input = dialog.getByLabel("选择文件", { exact: true })
        await input.focus()
        await input.setInputFiles({
          name: "theirs.bin",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("their replacement"),
        })
        const submitted = otherPage.waitForResponse(
          writes(
            f.organization.id,
            `entries/${original.result.entryId}/overwrite`
          )
        )
        await dialog
          .getByRole("button", { name: "确认覆盖", exact: true })
          .click()
        const response = await submitted
        expect(response.status()).toBe(200)
        const theirs = FileOperationResponseSchema.parse(await response.json())
        expect(theirs.result.revision).toBe(2)
        await expectUI(dialog).toHaveCount(0)
        expect(await physical(f, "并发版本.txt")).toEqual(
          Buffer.from("their replacement")
        )
      } finally {
        await other.close()
      }
      const rejected = page.waitForResponse(
        writes(
          f.organization.id,
          `entries/${original.result.entryId}/overwrite`
        )
      )
      await stale.start()
      const response = await rejected
      expect(response.status()).toBe(409)
      expect((await response.json()).code).toBe("VERSION_CONFLICT")
      const failed = queue()
        .getByRole("listitem", { name: "并发版本.txt", exact: true })
        .filter({
          has: page.getByRole("button", { name: "重新上传", exact: true }),
        })
      await expectUI(failed.getByRole("status")).toHaveText("上传未完成")
      const rejectedId = (await records(f)).at(-1).id
      expect(await journal(f, rejectedId)).toMatchObject({
        phase: "failed",
        error_code: "VERSION_CONFLICT",
        committed_at: null,
      })
      expect(await physical(f, "并发版本.txt")).toEqual(
        Buffer.from("their replacement")
      )
      await failed
        .getByRole("button", { name: "重新上传", exact: true })
        .click()
      const retry = page.getByRole("dialog", { name: "覆盖文件", exact: true })
      await expectUI(retry.getByText("mine.bin", { exact: true })).toBeVisible()
      await expectUI(retry.getByText(/现有引用仍指向原版本/)).toBeVisible()
      const accepted = page.waitForResponse(
        writes(
          f.organization.id,
          `entries/${original.result.entryId}/overwrite`
        )
      )
      await retry.getByRole("button", { name: "确认覆盖", exact: true }).click()
      const completed = FileOperationResponseSchema.parse(
        await (await accepted).json()
      )
      expect(completed.id).not.toBe(rejectedId)
      expect(completed.result.revision).toBe(3)
      await expectUI(queue().getByRole("status")).toHaveText([
        "上传完成",
        "上传未完成",
        "上传完成",
      ])
      expect(await physical(f, "并发版本.txt")).toEqual(
        Buffer.from("my replacement")
      )
    })

    it("丢失真实成功响应只GET原UUID，不重复POST或覆盖", async () => {
      const f = await fixture()
      let posts = 0,
        operation
      const endpoint = `**/api/v1/organizations/${f.organization.id}/files/uploads`
      await page.route(endpoint, async (route) => {
        posts++
        const response = await route.fetch()
        operation = await response.json()
        await route.abort("failed")
      })
      const form = await selection({
        name: "待确认.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("committed once"),
      })
      await form.start()
      await expectUI(
        queue()
          .getByRole("listitem", { name: "待确认.txt", exact: true })
          .getByRole("status")
      ).toHaveText("上传完成")
      expect(posts).toBe(1)
      expect((await records(f))[0].id).toBe(operation.id)
      expect(await journal(f, operation.id)).toMatchObject({
        phase: "completed",
      })
      expect(await physical(f, "待确认.txt")).toEqual(
        Buffer.from("committed once")
      )
    })

    it("选择弹层关闭后仍处理，刷新可找回同UUID与已保存文件，期间不重复写", async () => {
      const f = await fixture()
      let posts = 0,
        operation,
        release
      const ready = new Promise((resolve) => {
        release = resolve
      })
      await page.route(
        `**/api/v1/organizations/${f.organization.id}/files/uploads`,
        async (route) => {
          posts++
          const response = await route.fetch()
          operation = await response.json()
          await ready
          try {
            await route.fulfill({ response })
          } catch {
            /* 刷新已取消旧页面的真实响应；服务端操作事实保持不变。 */
          }
        }
      )
      const form = await selection({
        name: "刷新恢复.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("only once"),
      })
      await form.start()
      await expectUI(form.dialog).toHaveCount(0)
      await expectUI(queue().getByRole("status")).toHaveText("正在提交/处理")
      await expect.poll(() => operation?.phase).toBe("completed")
      const before = await records(f)
      expect(before[0]).toMatchObject({
        id: operation.id,
        phase: "unconfirmed",
        submitted: true,
      })
      await page.reload()
      release()
      await expectUI(queue().getByRole("status")).toHaveText("上传完成")
      expect(posts).toBe(1)
      expect((await records(f))[0].id).toBe(operation.id)
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "刷新恢复.txt", exact: true })
      ).toBeVisible()
    })

    it("UI校验真实超限文件不发写请求并保留选择", async () => {
      const f = await fixture()
      let posts = 0
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request
            .url()
            .endsWith(`/organizations/${f.organization.id}/files/uploads`)
        )
          posts++
      })
      const directory = await mkdtemp(join(tmpdir(), "files-upload-limit-"))
      resources.defer(() => rm(directory, { recursive: true, force: true }))
      const payload = join(directory, "large.bin")
      const selected = await open(payload, "w")
      await selected.truncate(100 * 1024 ** 2 + 1)
      await selected.close()
      const form = await selection(payload)
      await form.start()
      await expectUI(
        form.dialog.getByText("文件超过允许的大小，请选择更小的文件。", {
          exact: true,
        })
      ).toBeVisible()
      expect(posts).toBe(0)
      await expectUI(
        form.dialog.getByText("large.bin", { exact: true })
      ).toBeVisible()
    })

    it("真实100MiB原生文件上传与授权下载，原始字节SHA和配额一致", async () => {
      const f = await fixture()
      const bytes = 100 * 1024 ** 2
      const directory = await mkdtemp(join(tmpdir(), "files-upload-maximum-"))
      resources.defer(() => rm(directory, { recursive: true, force: true }))
      const payload = join(directory, "maximum.bin")
      const selected = await open(payload, "w")
      await selected.truncate(bytes)
      await selected.close()
      const digest = async (path) => {
        const hash = createHash("sha256")
        for await (const chunk of createReadStream(path)) hash.update(chunk)
        return hash.digest("hex")
      }
      const expected = await digest(payload)
      const form = await selection(payload)
      const submitted = page.waitForResponse(writes(f.organization.id))
      await form.start()
      const response = await submitted
      expect(response.status()).toBe(200)
      const operation = FileOperationResponseSchema.parse(await response.json())
      expect(operation.phase).toBe("completed")
      await expectUI(queue().getByRole("status")).toHaveText("上传完成")
      await queue()
        .getByRole("button", { name: "查看所上传版本", exact: true })
        .click()
      const downloaded = page.waitForEvent("download")
      await page.getByRole("button", { name: "下载文件", exact: true }).click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe("maximum.bin")
      expect(await download.failure()).toBeNull()
      const path = await download.path()
      expect((await stat(path)).size).toBe(bytes)
      expect(await digest(path)).toBe(expected)
      const usage = await environment.observer.query(
        "SELECT used_bytes, reserved_bytes, transient_bytes FROM public.file_storage_usage WHERE organization_id=$1",
        [f.organization.id]
      )
      expect(Number(usage.rows[0].used_bytes)).toBe(bytes)
      expect(Number(usage.rows[0].reserved_bytes)).toBe(0)
      expect(Number(usage.rows[0].transient_bytes)).toBe(0)
    })

    it("中文文件名255字节成功，超限保留原选择且不提交，NFC名称按统一规则入库", async () => {
      const f = await fixture()
      const longest = "界".repeat(85)
      const body = Buffer.from("filename boundary")
      await upload(f, longest, body)
      expect(await physical(f, longest)).toEqual(body)
      let posts = 0
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request
            .url()
            .endsWith(`/organizations/${f.organization.id}/files/uploads`)
        )
          posts++
      })
      const form = await selection({
        name: "original.txt",
        mimeType: "text/plain",
        buffer: body,
      })
      const name = form.dialog.getByRole("textbox", {
        name: "上传后的文件名",
        exact: true,
      })
      await name.fill("界".repeat(86))
      await form.start()
      await expectUI(
        form.dialog.getByText("名称过长，请使用更短的名称。", { exact: true })
      ).toBeVisible()
      await expectUI(name).toHaveValue("界".repeat(86))
      await expectUI(
        form.dialog.getByText("original.txt", { exact: true })
      ).toBeVisible()
      expect(posts).toBe(0)
      await name.fill("Cafe\u0301.txt")
      const submitted = page.waitForResponse(writes(f.organization.id))
      await form.start()
      expect((await submitted).status()).toBe(200)
      await expectUI(queue().getByRole("status")).toHaveText([
        "上传完成",
        "上传完成",
      ])
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "Café.txt", exact: true })
      ).toBeVisible()
      expect(await physical(f, "Café.txt")).toEqual(body)
    })

    it("真实相对路径512字节可保存，513字节被拒绝且保持当前层级和原File", async () => {
      const f = await fixture()
      const parents = ["甲".repeat(82), "乙".repeat(82)]
      for (const name of parents) await createFolder(name)
      const location = page.url()
      const acceptedName = "a".repeat(18)
      const body = Buffer.from("path boundary")
      expect(Buffer.byteLength([...parents, acceptedName].join("/"))).toBe(512)
      await upload(f, acceptedName, body)
      expect(await physical(f, acceptedName, parents)).toEqual(body)
      const rejectedName = "b".repeat(19)
      const form = await selection({
        name: rejectedName,
        mimeType: "text/plain",
        buffer: body,
      })
      const submitted = page.waitForResponse(writes(f.organization.id))
      await form.start()
      const response = await submitted
      expect(response.status()).toBeGreaterThanOrEqual(400)
      expect(response.status()).toBeLessThan(500)
      expect((await response.json()).code).toBe("FILE_PATH_TOO_LONG")
      const job = queue().getByRole("listitem", {
        name: rejectedName,
        exact: true,
      })
      await expectUI(job.getByRole("status")).toHaveText("上传未完成")
      await expectUI(job.getByRole("alert")).toHaveText(
        "文件夹层级与名称组合过长，请缩短名称或选择层级更浅的目标。"
      )
      expect(page.url()).toBe(location)
      await job.getByRole("button", { name: "重新上传", exact: true }).click()
      const retry = page.getByRole("dialog", { name: "上传文件", exact: true })
      await expectUI(
        retry.getByRole("textbox", { name: "上传后的文件名", exact: true })
      ).toHaveValue(rejectedName)
      await expectUI(
        retry.getByText(rejectedName, { exact: true })
      ).toBeVisible()
      expect(page.url()).toBe(location)
    })

    it("实际配额不足不发布且释放预留，失败原File可在管理员调额后明确重新上传", async () => {
      const f = await fixture()
      await environment.observer.query(
        "UPDATE public.file_storage_usage SET quota_bytes=1 WHERE organization_id=$1",
        [f.organization.id]
      )
      const body = Buffer.from([4, 8])
      const form = await selection({
        name: "容量.bin",
        mimeType: "application/octet-stream",
        buffer: body,
      })
      const submitted = page.waitForResponse(writes(f.organization.id))
      await form.start()
      const response = await submitted
      expect(response.status()).toBeGreaterThanOrEqual(400)
      expect(response.status()).toBeLessThan(500)
      expect((await response.json()).code).toBe("FILE_QUOTA_EXCEEDED")
      const job = queue().getByRole("listitem", {
        name: "容量.bin",
        exact: true,
      })
      await expectUI(job.getByRole("status")).toHaveText("上传未完成")
      await expectUI(job.getByRole("alert")).toHaveText(
        "组织可用存储空间不足，请联系管理员。"
      )
      const rejectedId = (await records(f))[0].id
      expect(await journal(f, rejectedId)).toMatchObject({
        phase: "failed",
        error_code: "FILE_QUOTA_EXCEEDED",
        committed_at: null,
      })
      const usage = await environment.observer.query(
        "SELECT used_bytes, reserved_bytes, transient_bytes FROM public.file_storage_usage WHERE organization_id=$1",
        [f.organization.id]
      )
      expect(usage.rows[0]).toEqual({
        used_bytes: "0",
        reserved_bytes: "0",
        transient_bytes: "0",
      })
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "容量.bin", exact: true })
      ).toHaveCount(0)
      await environment.observer.query(
        "UPDATE public.file_storage_usage SET quota_bytes=2, policy_revision=policy_revision+1 WHERE organization_id=$1",
        [f.organization.id]
      )
      await job.getByRole("button", { name: "重新上传", exact: true }).click()
      const retry = page.getByRole("dialog", { name: "上传文件", exact: true })
      await expectUI(
        retry.getByRole("textbox", { name: "上传后的文件名", exact: true })
      ).toHaveValue("容量.bin")
      const accepted = page.waitForResponse(writes(f.organization.id))
      await retry.getByRole("button", { name: "开始上传", exact: true }).click()
      const completed = FileOperationResponseSchema.parse(
        await (await accepted).json()
      )
      expect(completed.id).not.toBe(rejectedId)
      expect(completed.phase).toBe("completed")
      await expectUI(queue().getByRole("status")).toHaveText([
        "上传未完成",
        "上传完成",
      ])
      expect(await physical(f, "容量.bin")).toEqual(body)
    })

    it("仅file:upload的自定义角色能上传但不能覆盖，内置member只能读取", async () => {
      const f = await fixture()
      await upload(f, "原文件.txt", Buffer.from("original"))
      const uploader = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "仅上传用户" }
      )
      const reader = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "仅查看成员" }
      )
      await environment.runtime.auth.api.createOrgRole({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          role: "file-uploader",
          permission: { file: ["read", "upload"], folder: ["read"] },
        },
      })
      for (const [account, role] of [
        [uploader, "file-uploader"],
        [reader, "member"],
      ])
        await environment.runtime.auth.api.addMember({
          headers: f.owner.headers,
          body: {
            organizationId: f.organization.id,
            userId: account.user.id,
            role,
          },
        })
      await context.clearCookies()
      await signIn(page, uploader, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(
        page.getByRole("button", { name: "上传文件", exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "创建文件夹", exact: true })
      ).toHaveCount(0)
      await expectUI(page.locator("tbody").getByRole("checkbox")).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: "覆盖文件", exact: true })
      ).toHaveCount(0)
      await upload(f, "仅上传.txt", Buffer.from("uploader"))
      expect(await physical(f, "仅上传.txt")).toEqual(Buffer.from("uploader"))
      const actors = await environment.observer.query(
        "SELECT actor_id FROM public.file_operations WHERE organization_id=$1 AND action='upload' ORDER BY created_at",
        [f.organization.id]
      )
      expect(actors.rows.map((row) => row.actor_id)).toEqual([
        f.owner.user.id,
        uploader.user.id,
      ])
      await context.clearCookies()
      await signIn(page, reader, environment.tenantOrigin)
      await page.getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(
        page
          .locator("tbody")
          .getByRole("button", { name: "仅上传.txt", exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "上传文件", exact: true })
      ).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: "覆盖文件", exact: true })
      ).toHaveCount(0)
      await expectUI(
        page.getByRole("button", { name: "创建文件夹", exact: true })
      ).toHaveCount(0)
      await expectUI(page.locator("tbody").getByRole("checkbox")).toHaveCount(0)
    })

    it.each([
      {
        locale: "English",
        upload: "Upload files",
        choose: "Choose files",
        start: "Start upload",
        queue: "Upload tasks",
        done: "Upload completed",
      },
      {
        locale: "العربية",
        upload: "رفع ملفات",
        choose: "اختيار ملفات",
        start: "بدء الرفع",
        queue: "مهام الرفع",
        done: "اكتمل الرفع",
      },
    ])("$locale 的正式上传使用真实同一层级与RTL", async (labels) => {
      const f = await fixture()
      await selectLocale(page, f.owner.user.name, labels.locale)
      const location = page.url()
      if (labels.locale === "العربية")
        await expectUI(page.locator("html")).toHaveAttribute("dir", "rtl")
      const form = await selection(
        {
          name: "Locale.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("locale file"),
        },
        { trigger: labels.upload, field: labels.choose, start: labels.start }
      )
      await form.start()
      await expectUI(
        page
          .getByRole("region", { name: labels.queue, exact: true })
          .getByRole("status")
      ).toHaveText(labels.done)
      expect(page.url()).toBe(location)
      expect(await physical(f, "Locale.txt")).toEqual(
        Buffer.from("locale file")
      )
    })
  }
)
