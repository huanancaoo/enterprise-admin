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
      const remote = (value) => {
        const url = new URL(value)
        url.hostname = "host.docker.internal"
        return url.toString()
      }
      const config = {
        ...runtime.config,
        databaseURL: remote(runtime.config.databaseURL),
        redisURL: remote(runtime.config.redisURL),
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

describe.each(["Local", "RustFS"])(
  "S9 %s：正式文件路径与回收站产品链路",
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
    const rows = () => page.locator("tbody")
    const row = (name) =>
      rows()
        .getByRole("row")
        .filter({ has: page.getByRole("button", { name, exact: true }) })
    const queue = (locale = "zh-CN") =>
      page.getByRole("region", { name: labels[locale].pathQueue, exact: true })
    const predicate = (f, entry, action) => (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/organizations/${f.organization.id}/files/entries/${entry.id}/${action}`
    async function native(f, suffix, input) {
      const response = await request(
        f,
        suffix,
        input === undefined ? {} : json(input)
      )
      expect(response.status, await response.clone().text()).toBe(200)
      return response.json()
    }
    async function fixture() {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "路径验收用户" }
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "路径验收组织", slug: `path-product-${randomUUID()}` },
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
      bytes = Buffer.from("真实原字节 مرحبا\n"),
      overwrite
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
      form.append("file", new File([bytes], name, { type: "text/plain" }))
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
    async function projectReference(f, file) {
      const response = await request(
        f,
        "/projects",
        json({
          name: "正式附件引用",
          description: "保持原概要",
          contentLocale: "zh-CN",
          attachments: [{ fileId: file.id, versionId: file.fixedVersionId }],
        })
      )
      expect(response.status, await response.clone().text()).toBe(201)
      return response.json()
    }
    async function clearReference(f, project) {
      const response = await request(f, `/projects/${project.id}`, {
        ...json({ attachments: { expectedRevision: 1, items: [] } }),
        method: "PATCH",
      })
      expect(response.status, await response.clone().text()).toBe(200)
    }
    async function openFiles(f, actor = f.owner) {
      await signIn(page, actor, environment.tenantOrigin)
      await expectUI(rows()).toBeVisible()
    }
    async function selectEntry(name) {
      await expectUI(row(name)).toHaveCount(1)
      await row(name).getByRole("checkbox").check()
    }
    async function openAction(
      entry,
      action,
      locale = "zh-CN",
      keyboard = false
    ) {
      await selectEntry(entry.name)
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
      const submitted = page.waitForResponse(predicate(f, entry, action))
      await dialog
        .getByRole("button", {
          name: labels[locale][action + "Entry"],
          exact: true,
        })
        .click()
      const response = await submitted
      expect(response.status(), await response.text()).toBe(200)
      const receipt = FileOperationResponseSchema.parse(await response.json())
      expect(receipt.phase).toBe("completed")
      await expectUI(dialog).toHaveCount(0)
      await expectUI(queue(locale).getByRole("status").last()).toHaveText(
        labels[locale].pathCompleted
      )
      return receipt
    }
    async function destination(
      dialog,
      target,
      action = "move",
      locale = "zh-CN"
    ) {
      await dialog
        .getByRole("button", {
          name: labels[locale][
            action === "restore" ? "restoreLocation" : "destination"
          ],
          exact: true,
        })
        .click()
      const picker = page.getByRole("dialog", {
        name: labels[locale].pickFolder,
        exact: true,
      })
      await picker
        .locator("tbody")
        .getByRole("button", { name: target.name, exact: true })
        .click()
      await expectUI(
        picker.getByRole("navigation", {
          name: labels[locale].folderNavigation,
          exact: true,
        })
      ).toContainText(target.name)
      await picker
        .getByRole("button", { name: labels[locale].useFolder, exact: true })
        .click()
      await expectUI(picker).toHaveCount(0)
      await expectUI(dialog).toContainText(target.name)
    }
    async function entryFacts(f, entry) {
      return (
        await environment.observer.query(
          "SELECT * FROM file_entries WHERE organization_id=$1 AND id=$2",
          [f.organization.id, entry.id]
        )
      ).rows[0]
    }
    async function versionFacts(f, entry) {
      return (
        await environment.observer.query(
          "SELECT * FROM file_versions WHERE organization_id=$1 AND file_id=$2 ORDER BY created_at,id",
          [f.organization.id, entry.id]
        )
      ).rows
    }
    async function usage(f, expected) {
      const actual = (
        await environment.observer.query(
          "SELECT used_bytes,reserved_bytes,transient_bytes FROM file_storage_usage WHERE organization_id=$1",
          [f.organization.id]
        )
      ).rows[0]
      expect(actual).toEqual({
        used_bytes: String(expected),
        reserved_bytes: "0",
        transient_bytes: "0",
      })
    }
    async function fixedBytes(
      f,
      file,
      bytes = file.originalBytes,
      actor = f.owner
    ) {
      const response = await request(
        f,
        `/files/entries/${file.id}/versions/${file.fixedVersionId}/content`,
        {},
        actor
      )
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    }
    async function trashTab() {
      await page
        .getByRole("group", { name: labels["zh-CN"].views, exact: true })
        .getByRole("button", { name: labels["zh-CN"].trash, exact: true })
        .click()
      await expectUI(page).toHaveURL(/state=trashed/)
    }
    async function activeTab() {
      await page
        .getByRole("group", { name: labels["zh-CN"].views, exact: true })
        .getByRole("button", { name: labels["zh-CN"].activeFiles, exact: true })
        .click()
    }
    async function trashEntry(f, entry) {
      const dialog = await openAction(entry, "trash")
      await expectUI(
        dialog.getByRole("button", {
          name: labels["zh-CN"].trashEntry,
          exact: true,
        })
      ).toBeEnabled()
      return submit(f, entry, "trash", dialog)
    }

    it("文件改名与移动只改变路径，旧固定版本和新当前版本仍读取原字节", async () => {
      const f = await fixture(),
        target = await folder(f, "目标目录"),
        original = await upload(f, "原文件.txt")
      const current = await upload(
        f,
        "原文件.txt",
        f.root,
        Buffer.from("覆盖后的当前版本"),
        original
      )
      await openFiles(f)
      const dialog = await openAction(current, "rename")
      await dialog.getByLabel("名称", { exact: true }).fill("更名.txt")
      await submit(f, current, "rename", dialog)
      const renamed = await native(f, `/files/entries/${current.id}`)
      await expectUI(row("更名.txt")).toBeVisible()
      expect(renamed.currentVersion.id).toBe(current.fixedVersionId)
      expect(
        await environment.physical(address(f, "files", ["原文件.txt"]))
      ).toBeNull()
      expect(
        await environment.physical(address(f, "files", ["更名.txt"]))
      ).toEqual(current.originalBytes)
      await fixedBytes(f, original)
      await fixedBytes(f, current)
      // 第一次完成会清掉旧选择；新的移动由当前条目与 revision 明确发起。
      const move = await openAction(renamed, "move")
      await destination(move, target)
      await submit(f, renamed, "move", move)
      await rows()
        .getByRole("button", { name: target.name, exact: true })
        .click()
      const location = page.url()
      await page.reload()
      await expectUI(row("更名.txt")).toBeVisible()
      expect(page.url()).toBe(location)
      expect((await entryFacts(f, current)).path).toEqual([
        target.name,
        "更名.txt",
      ])
      expect(
        await environment.physical(
          address(f, "files", [target.name, "更名.txt"])
        )
      ).toEqual(current.originalBytes)
      await fixedBytes(f, original)
      await fixedBytes(f, current)
      await usage(
        f,
        original.originalBytes.length + current.originalBytes.length
      )
    })

    it("目录改名与整树移动保留子项UUID、固定版本、空目录标记和层级刷新", async () => {
      const f = await fixture(),
        tree = await folder(f, "原目录"),
        nested = await folder(f, "深层", tree),
        empty = await folder(f, "空目录", nested),
        target = await folder(f, "整树目标"),
        file = await upload(f, "子文件.txt", nested)
      await openFiles(f)
      const rename = await openAction(tree, "rename")
      await rename.getByLabel("名称", { exact: true }).fill("新目录")
      await submit(f, tree, "rename", rename)
      const renamed = await native(f, `/files/entries/${tree.id}`)
      await expectUI(row(renamed.name)).toBeVisible()
      const move = await openAction(renamed, "move")
      await destination(move, target)
      await submit(f, renamed, "move", move)
      for (const name of [target.name, renamed.name, nested.name])
        await rows().getByRole("button", { name, exact: true }).click()
      await expectUI(page).toHaveURL(new RegExp(`parentId=${nested.id}`))
      await page.reload()
      await expectUI(row(file.name)).toBeVisible()
      await expectUI(
        page.getByRole("navigation", { name: labels["zh-CN"].folderNavigation })
      ).toContainText(`${target.name}`)
      expect((await entryFacts(f, file)).path).toEqual([
        target.name,
        renamed.name,
        nested.name,
        file.name,
      ])
      expect((await entryFacts(f, empty)).parent_id).toBe(nested.id)
      expect(
        await environment.directory(
          address(f, "files", [
            target.name,
            renamed.name,
            nested.name,
            empty.name,
          ])
        )
      ).toBe(true)
      expect(
        await environment.directory(address(f, "files", [tree.name]))
      ).toBe(false)
      expect(
        await environment.physical(
          address(f, "files", [
            target.name,
            renamed.name,
            nested.name,
            file.name,
          ])
        )
      ).toEqual(file.originalBytes)
      await fixedBytes(f, file)
      await usage(f, file.originalBytes.length)
    })

    it("正式项目附件引用阻止整树删除，解除引用后重新预检才允许删除", async () => {
      const f = await fixture(),
        tree = await folder(f, "引用目录"),
        file = await upload(f, "引用附件.txt", tree),
        project = await projectReference(f, file)
      await openFiles(f)
      const writes = []
      page.on("request", (r) => {
        if (
          r.method() === "POST" &&
          r.url().endsWith(`/entries/${tree.id}/trash`)
        )
          writes.push(r)
      })
      const blocked = await openAction(tree, "trash")
      await expectUI(blocked.getByRole("alert")).toContainText("业务引用：1 个")
      await expectUI(
        blocked.getByRole("button", {
          name: labels["zh-CN"].trashEntry,
          exact: true,
        })
      ).toBeDisabled()
      expect(writes).toHaveLength(0)
      expect((await entryFacts(f, tree)).state).toBe("active")
      await fixedBytes(f, file)
      await blocked.getByRole("button", { name: "取消", exact: true }).click()
      await clearReference(f, project)
      const dialog = await openAction(tree, "trash")
      await expectUI(
        dialog.getByRole("button", {
          name: labels["zh-CN"].trashEntry,
          exact: true,
        })
      ).toBeEnabled()
      await submit(f, tree, "trash", dialog)
      expect(writes).toHaveLength(1)
      expect((await entryFacts(f, file)).state).toBe("trashed")
      await usage(f, file.originalBytes.length)
    })

    it("删除预检后新建真实引用，服务端再次检查并保留目录与固定内容", async () => {
      const f = await fixture(),
        tree = await folder(f, "检查后引用"),
        file = await upload(f, "被引用.txt", tree)
      await openFiles(f)
      const dialog = await openAction(tree, "trash")
      await expectUI(
        dialog.getByRole("button", {
          name: labels["zh-CN"].trashEntry,
          exact: true,
        })
      ).toBeEnabled()
      await projectReference(f, file)
      const submitted = page.waitForResponse(predicate(f, tree, "trash"))
      await dialog
        .getByRole("button", { name: labels["zh-CN"].trashEntry, exact: true })
        .click()
      const response = await submitted
      expect(response.status()).toBe(409)
      expect((await response.json()).code).toBe("FILE_REFERENCED")
      await expectUI(dialog.getByRole("alert")).toContainText("引用")
      expect((await entryFacts(f, tree)).state).toBe("active")
      expect((await entryFacts(f, file)).state).toBe("active")
      await fixedBytes(f, file)
      await usage(f, file.originalBytes.length)
    })

    it("深层回收站显示原位置与期限，真实UUID导航刷新后仍能还原子树", async () => {
      const f = await fixture(),
        parent = await folder(f, "原位置"),
        tree = await folder(f, "待回收", parent),
        nested = await folder(f, "深层回收", tree),
        file = await upload(f, "保留.txt", nested)
      await openFiles(f)
      await rows()
        .getByRole("button", { name: parent.name, exact: true })
        .click()
      const receipt = await trashEntry(f, tree)
      expect(receipt.result.affectedEntries).toBe(3)
      await trashTab()
      expect(new URL(page.url()).searchParams.has("parentId")).toBe(false)
      await expectUI(row(tree.name)).toContainText(parent.name)
      await expectUI(
        page.getByRole("columnheader", { name: "删除时间", exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("columnheader", { name: "到期时间", exact: true })
      ).toBeVisible()
      for (const name of [tree.name, nested.name])
        await rows().getByRole("button", { name, exact: true }).click()
      await expectUI(page).toHaveURL(new RegExp(`parentId=${nested.id}`))
      await page.reload()
      await expectUI(row(file.name)).toBeVisible()
      await expectUI(
        row(file.name).getByRole("button", { name: file.name, exact: true })
      ).toBeDisabled()
      const navigation = page.getByRole("navigation", {
        name: labels["zh-CN"].folderNavigation,
        exact: true,
      })
      await expectUI(navigation).toContainText(tree.name)
      expect(
        (
          await request(
            f,
            `/files/entries/${file.id}/versions/${file.fixedVersionId}/content`
          )
        ).status
      ).toBe(404)
      expect(
        await environment.physical(
          address(f, "trash", [tree.id, file.fixedVersionId])
        )
      ).toEqual(file.originalBytes)
      await navigation
        .getByRole("button", { name: labels["zh-CN"].trash, exact: true })
        .click()
      const restore = await openAction(
        await native(f, `/files/entries/${tree.id}`),
        "restore"
      )
      await expectUI(restore).toContainText("原来的文件夹")
      await submit(f, tree, "restore", restore)
      await activeTab()
      for (const name of [parent.name, tree.name, nested.name])
        await rows().getByRole("button", { name, exact: true }).click()
      await expectUI(row(file.name)).toBeVisible()
      await fixedBytes(f, file)
      expect(
        await environment.physical(
          address(f, "trash", [tree.id, file.fixedVersionId])
        )
      ).toBeNull()
      await usage(f, file.originalBytes.length)
    })

    it("恢复原名冲突保留草稿和失败收据，明确另名与目标以新UUID恢复", async () => {
      const f = await fixture(),
        tree = await folder(f, "相同名称"),
        target = await folder(f, "恢复目标"),
        file = await upload(f, "草稿保留.txt", tree)
      await openFiles(f)
      await trashEntry(f, tree)
      await folder(f, tree.name)
      await trashTab()
      const current = await native(f, `/files/entries/${tree.id}`),
        dialog = await openAction(current, "restore")
      const first = page.waitForResponse(predicate(f, current, "restore"))
      await dialog
        .getByRole("button", {
          name: labels["zh-CN"].restoreEntry,
          exact: true,
        })
        .click()
      const rejected = await first
      expect(rejected.status()).toBe(409)
      expect((await rejected.json()).code).toBe("FILE_NAME_CONFLICT")
      const oldId = rejected.request().postDataJSON().operationId
      await expectUI(dialog.getByLabel("名称", { exact: true })).toHaveValue(
        tree.name
      )
      await expectUI(dialog.getByRole("alert")).toContainText("同名")
      await dialog.getByLabel("名称", { exact: true }).fill("明确恢复名")
      await destination(dialog, target, "restore")
      const second = await submit(f, current, "restore", dialog)
      expect(second.id).not.toBe(oldId)
      expect(await native(f, `/files/operations/${oldId}`)).toMatchObject({
        phase: "failed",
        errorCode: "FILE_NAME_CONFLICT",
        committedAt: null,
      })
      await activeTab()
      await rows()
        .getByRole("button", { name: target.name, exact: true })
        .click()
      await expectUI(row("明确恢复名")).toBeVisible()
      expect((await entryFacts(f, file)).path).toEqual([
        target.name,
        "明确恢复名",
        file.name,
      ])
      await fixedBytes(f, file)
      await usage(f, file.originalBytes.length)
    })

    it("永久删除需明确确认，所有历史与当前对象清除后容量结算一次", async () => {
      const f = await fixture(),
        first = await upload(f, "多版本.txt"),
        current = await upload(
          f,
          first.name,
          f.root,
          Buffer.from("第二版本实际字节"),
          first
        )
      await openFiles(f)
      await trashEntry(f, current)
      await usage(f, first.originalBytes.length + current.originalBytes.length)
      await trashTab()
      const entry = await native(f, `/files/entries/${current.id}`),
        confirm = await openAction(entry, "purge")
      await expectUI(confirm).toContainText("此操作无法撤销")
      const versionsBefore = await versionFacts(f, current)
      expect(versionsBefore).toHaveLength(2)
      for (const version of versionsBefore)
        expect(
          await environment.physical(
            address(f, version.storage_area, version.storage_path)
          )
        ).not.toBeNull()
      await confirm.getByRole("button", { name: "取消", exact: true }).click()
      expect((await entryFacts(f, current)).state).toBe("trashed")
      const dialog = await openAction(entry, "purge")
      await expectUI(
        dialog.getByRole("button", {
          name: labels["zh-CN"].purgeEntry,
          exact: true,
        })
      ).toBeEnabled()
      const receipt = await submit(f, entry, "purge", dialog)
      await expectUI(row(current.name)).toHaveCount(0)
      expect((await entryFacts(f, current)).state).toBe("purged")
      expect(
        (await versionFacts(f, current)).every(
          (version) => version.purged_at !== null
        )
      ).toBe(true)
      for (const version of versionsBefore)
        expect(
          await environment.physical(
            address(f, version.storage_area, version.storage_path)
          )
        ).toBeNull()
      expect(
        await environment.directory(address(f, "trash", [current.id]))
      ).toBe(false)
      await usage(f, 0)
      await page.reload()
      await usage(f, 0)
      expect((await request(f, `/files/entries/${current.id}`)).status).toBe(
        404
      )
      const audits = await environment.observer.query(
        "SELECT count(*)::int AS total FROM audit_events WHERE organization_id=$1 AND operation_id=$2 AND event_code='file.purged'",
        [f.organization.id, receipt.id]
      )
      expect(audits.rows[0].total).toBe(1)
    })

    it("回收期限到期后正式恢复拒绝，草稿与原operation事实保留", async () => {
      const f = await fixture(),
        file = await upload(f, "到期.txt")
      await openFiles(f)
      await trashEntry(f, file)
      // 只推进本夹具条目的期限，用正式服务校验已过期状态；不改 phase 或操作计划。
      await environment.observer.query(
        "UPDATE file_entries SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1 AND id=$2",
        [f.organization.id, file.id]
      )
      await trashTab()
      const dialog = await openAction(
        await native(f, `/files/entries/${file.id}`),
        "restore"
      )
      await dialog.getByLabel("名称", { exact: true }).fill("恢复草稿.txt")
      const rejected = page.waitForResponse(predicate(f, file, "restore"))
      await dialog
        .getByRole("button", {
          name: labels["zh-CN"].restoreEntry,
          exact: true,
        })
        .click()
      const response = await rejected
      expect(response.status()).toBe(409)
      expect((await response.json()).code).toBe("FILE_RESTORE_EXPIRED")
      await expectUI(dialog.getByLabel("名称", { exact: true })).toHaveValue(
        "恢复草稿.txt"
      )
      await expectUI(dialog.getByRole("alert")).toContainText("恢复期限")
      expect((await entryFacts(f, file)).state).toBe("trashed")
    })

    it("Native只读member不能选择写动作或回收站，正式服务拒绝直接写入", async () => {
      const f = await fixture(),
        file = await upload(f, "只读内容.txt"),
        reader = await signUpVerified(
          environment.baseURL,
          environment.tenantOrigin,
          environment.migrator,
          { name: "只读验收成员" }
        )
      await environment.runtime.auth.api.addMember({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          userId: reader.user.id,
          role: "member",
        },
      })
      await openFiles(f, reader)
      await expectUI(row(file.name)).toBeVisible()
      await expectUI(rows().getByRole("checkbox")).toHaveCount(0)
      for (const key of [
        "renameEntry",
        "moveEntry",
        "trashEntry",
        "restoreEntry",
        "purgeEntry",
        "trash",
      ])
        await expectUI(
          page.getByRole("button", { name: labels["zh-CN"][key], exact: true })
        ).toHaveCount(0)
      const response = await request(
        f,
        `/files/entries/${file.id}/rename`,
        json({
          operationId: randomUUID(),
          expectedRevision: file.revision,
          name: "未授权改名.txt",
        }),
        reader
      )
      expect(response.status).toBe(403)
      expect((await entryFacts(f, file)).name).toBe(file.name)
      await fixedBytes(f, file, file.originalBytes, reader)
    })

    it("打开旧会话改名草稿后Native角色撤权，真实提交403且文件和草稿保持", async () => {
      const f = await fixture(),
        file = await upload(f, "撤权前.txt"),
        actor = await signUpVerified(
          environment.baseURL,
          environment.tenantOrigin,
          environment.migrator,
          { name: "可撤权编辑者" }
        )
      const role = await environment.runtime.auth.api.createOrgRole({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          role: "file-editor",
          permission: { file: ["read", "update"], folder: ["read"] },
        },
      })
      await environment.runtime.auth.api.addMember({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          userId: actor.user.id,
          role: "file-editor",
        },
      })
      await openFiles(f, actor)
      const dialog = await openAction(file, "rename")
      await dialog.getByLabel("名称", { exact: true }).fill("撤权后草稿.txt")
      const held = Promise.withResolvers(),
        release = Promise.withResolvers()
      await page.route(
        `**/entries/${file.id}/rename`,
        async (route) => {
          held.resolve()
          await release.promise
          await route.continue()
        },
        { times: 1 }
      )
      const responsePromise = page.waitForResponse(predicate(f, file, "rename"))
      await dialog
        .getByRole("button", { name: labels["zh-CN"].renameEntry, exact: true })
        .click()
      await held.promise
      try {
        const version = (
          await environment.observer.query(
            "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
            [f.organization.id]
          )
        ).rows[0].authorization_version
        const changed = await fetch(
          environment.baseURL + "/api/auth/organization/update-role",
          {
            ...json({
              organizationId: f.organization.id,
              roleId: role.roleData.id,
              data: { permission: { file: ["read"], folder: ["read"] } },
            }),
            headers: {
              ...Object.fromEntries(f.owner.headers),
              "content-type": "application/json",
              "X-Expected-Authz-Version": String(version),
            },
          }
        )
        expect(changed.status, await changed.clone().text()).toBe(200)
      } finally {
        release.resolve()
      }
      const response = await responsePromise
      expect(response.status()).toBe(403)
      await expectUI(dialog.getByLabel("名称", { exact: true })).toHaveValue(
        "撤权后草稿.txt"
      )
      await expectUI(dialog.getByRole("alert")).toBeVisible()
      expect((await entryFacts(f, file)).name).toBe(file.name)
      await fixedBytes(f, file, file.originalBytes, actor)
    })

    it("真实改名成功响应丢失后只GET原UUID，刷新安全ledger不重复POST且末项dismiss有焦点", async () => {
      const f = await fixture(),
        file = await upload(f, "丢失响应前.txt")
      await openFiles(f)
      const writes = [],
        reads = []
      page.on("request", (r) => {
        const path = new URL(r.url()).pathname
        if (
          r.method() === "POST" &&
          path.endsWith(`/entries/${file.id}/rename`)
        )
          writes.push(r.postDataJSON())
        if (
          r.method() === "GET" &&
          path.startsWith(
            `/api/v1/organizations/${f.organization.id}/files/operations/`
          )
        )
          reads.push(path.split("/").at(-1))
      })
      await page.route(
        `**/entries/${file.id}/rename`,
        async (route) => {
          const actual = await route.fetch()
          expect(actual.status()).toBe(200)
          await route.abort("failed")
        },
        { times: 1 }
      )
      const dialog = await openAction(file, "rename")
      await dialog.getByLabel("名称", { exact: true }).fill("丢失响应后.txt")
      await dialog
        .getByRole("button", { name: labels["zh-CN"].renameEntry, exact: true })
        .click()
      await expectUI(queue().getByRole("status")).toHaveText(
        labels["zh-CN"].pathCompleted
      )
      expect(writes).toHaveLength(1)
      expect(reads).toEqual([writes[0].operationId])
      const key = `enterprise-admin:file-path-operations:${JSON.stringify([f.owner.user.id, f.organization.id])}`
      const ledger = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)),
        key
      )
      expect(ledger).toHaveLength(1)
      expect(Object.keys(ledger[0]).sort()).toEqual(
        ["id", "action", "phase", "createdAt", "updatedAt"].sort()
      )
      expect(ledger[0]).toMatchObject({
        id: writes[0].operationId,
        phase: "completed",
      })
      expect(JSON.stringify(ledger)).not.toContain(file.id)
      expect(JSON.stringify(ledger)).not.toContain(file.name)
      await page.reload()
      await expectUI(row("丢失响应后.txt")).toBeVisible()
      expect(writes).toHaveLength(1)
      const dismiss = queue().getByRole("button", {
        name: labels["zh-CN"].dismissOperation,
        exact: true,
      })
      await dismiss.focus()
      await dismiss.press("Enter")
      await expectUI(queue()).toHaveCount(0)
      const focused = await page.evaluate(() => ({
        tag: document.activeElement.tagName,
        tabindex: document.activeElement.getAttribute("tabindex"),
        containsTable: document.activeElement.querySelector("table") !== null,
      }))
      expect(focused).toEqual({
        tag: "DIV",
        tabindex: "-1",
        containsTable: true,
      })
      await fixedBytes(f, file)
      await usage(f, file.originalBytes.length)
    })

    it("改名请求已发布但回程未返回时刷新，只确认持久原UUID且不重发POST", async () => {
      const f = await fixture(),
        file = await upload(f, "刷新前.txt")
      await openFiles(f)
      const writes = [],
        reads = [],
        received = Promise.withResolvers(),
        release = Promise.withResolvers()
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname
        if (
          request.method() === "POST" &&
          path.endsWith(`/entries/${file.id}/rename`)
        )
          writes.push(request.postDataJSON())
        if (
          request.method() === "GET" &&
          path.startsWith(
            `/api/v1/organizations/${f.organization.id}/files/operations/`
          )
        )
          reads.push(path.split("/").at(-1))
      })
      await page.route(
        `**/entries/${file.id}/rename`,
        async (route) => {
          const response = await route.fetch()
          received.resolve(response.status())
          await release.promise
          await route.fulfill({ response })
        },
        { times: 1 }
      )
      try {
        const dialog = await openAction(file, "rename")
        await dialog.getByLabel("名称", { exact: true }).fill("刷新后.txt")
        await dialog
          .getByRole("button", {
            name: labels["zh-CN"].renameEntry,
            exact: true,
          })
          .click()
        expect(await received.promise).toBe(200)
        const key = `enterprise-admin:file-path-operations:${JSON.stringify([f.owner.user.id, f.organization.id])}`
        expect(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key))[0].phase,
            key
          )
        ).toBe("unconfirmed")
        await page.reload()
        await expectUI(row("刷新后.txt")).toBeVisible()
        await expectUI(queue().getByRole("status")).toHaveText(
          labels["zh-CN"].pathCompleted
        )
        expect(writes).toHaveLength(1)
        expect(reads.length).toBeGreaterThan(0)
        expect(reads.every((id) => id === writes[0].operationId)).toBe(true)
        expect(
          (await native(f, `/files/operations/${writes[0].operationId}`)).phase
        ).toBe("completed")
      } finally {
        release.resolve()
        await page.unrouteAll({ behavior: "wait" })
      }
      expect(writes).toHaveLength(1)
      await fixedBytes(f, file)
    })

    it("真实同级改名冲突保留名称草稿，明确修改后使用新操作身份", async () => {
      const f = await fixture(),
        file = await upload(f, "改名来源.txt")
      await folder(f, "冲突名称")
      await openFiles(f)
      const dialog = await openAction(file, "rename")
      await dialog.getByLabel("名称", { exact: true }).fill("冲突名称")
      const submitted = page.waitForResponse(predicate(f, file, "rename"))
      await dialog
        .getByRole("button", { name: labels["zh-CN"].renameEntry, exact: true })
        .click()
      const response = await submitted
      expect(response.status()).toBe(409)
      const oldId = response.request().postDataJSON().operationId
      await expectUI(dialog.getByLabel("名称", { exact: true })).toHaveValue(
        "冲突名称"
      )
      await expectUI(dialog.getByRole("alert")).toContainText("同名")
      expect((await entryFacts(f, file)).name).toBe(file.name)
      await dialog.getByLabel("名称", { exact: true }).fill("明确另名.txt")
      const completed = await submit(f, file, "rename", dialog)
      expect(completed.id).not.toBe(oldId)
      expect(await native(f, `/files/operations/${oldId}`)).toMatchObject({
        phase: "failed",
        committedAt: null,
        errorCode: "FILE_NAME_CONFLICT",
      })
      await expectUI(row("明确另名.txt")).toBeVisible()
      await fixedBytes(f, file)
    })

    it.each([
      {
        locale: "en-US",
        language: "English",
        name: "Keyboard renamed.txt",
        dir: "ltr",
      },
      { locale: "ar", language: "العربية", name: "اسم جديد.txt", dir: "rtl" },
    ])("$locale 正式改名使用键盘，保持层级与阅读方向", async (input) => {
      const f = await fixture(),
        file = await upload(f, "language.txt")
      await openFiles(f)
      await selectLocale(page, f.owner, input.language)
      await expectUI(page.locator("html")).toHaveAttribute("dir", input.dir)
      const location = page.url(),
        dialog = await openAction(file, "rename", input.locale, true)
      const field = dialog.getByLabel(labels[input.locale].newName, {
        exact: true,
      })
      await field.fill(input.name)
      const submitted = page.waitForResponse(predicate(f, file, "rename"))
      await field.press("Enter")
      const response = await submitted
      expect(response.status()).toBe(200)
      await expectUI(dialog).toHaveCount(0)
      await expectUI(row(input.name)).toBeVisible()
      expect(page.url()).toBe(location)
      expect((await entryFacts(f, file)).name).toBe(input.name)
      await fixedBytes(f, file)
    })
  }
)
