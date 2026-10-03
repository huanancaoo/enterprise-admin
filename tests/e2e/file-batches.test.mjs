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
import {
  FileOperationResponseSchema,
  FileBatchResponseSchema,
  ExecuteFileBatchSchema,
} from "../../packages/contracts/dist/index.js"
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
        ...runtime.containerConfig,
        files: { kind: "local", root: "/tmp/path-product-files" },
      }
      // Local 的正式存储能力要求 Linux 大小写敏感文件系统；数据保存在容器中而非 macOS 挂载卷。
      container = await new GenericContainer(versions.nodeImage)
        .withNetwork(runtime.containerNetwork)
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
  const direction = await page.locator("html").getAttribute("dir")
  await menu.press(direction === "rtl" ? "ArrowLeft" : "ArrowRight")
  const item = page.getByRole("menuitemradio", { name: language, exact: true })
  await expectUI(item).toBeVisible()
  await item.focus()
  await item.press("Enter")
  // 旧菜单退出时会归还焦点，下一次选择必须等待它完成卸载。
  await expectUI(page.getByRole("menu", { includeHidden: true })).toHaveCount(0)
}

describe.each(["Local", "RustFS"])(
  "S9 %s：正式批量文件操作产品链路",
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
    const rows = () => page.locator('[data-slot="data-table"] tbody')
    const row = (name) =>
      rows()
        .getByRole("row")
        .filter({
          has: page
            .getByRole("button", { name, exact: true })
            .and(page.locator("button[id]")),
        })
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
    const batchTitle = (action, locale = "zh-CN") =>
      labels[locale]["batch" + action[0].toUpperCase() + action.slice(1)]
    const results = (locale = "zh-CN") =>
      page.getByRole("region", {
        name: labels[locale].batchResults,
        exact: true,
      })
    const posted = (f) => (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/organizations/${f.organization.id}/files/batches`
    async function selectBatch(
      entries,
      action,
      locale = "zh-CN",
      keyboard = false
    ) {
      for (const entry of entries) await selectEntry(entry.name)
      const trigger = page.getByRole("button", {
        name: batchTitle(action, locale),
        exact: true,
      })
      if (keyboard) {
        await trigger.focus()
        await trigger.press("Enter")
      } else await trigger.click()
      const dialog = page.getByRole("dialog", {
        name: batchTitle(action, locale),
        exact: true,
      })
      await expectUI(dialog).toBeVisible()
      return dialog
    }
    async function chooseTarget(dialog, target, locale = "zh-CN") {
      await dialog
        .getByRole("button", {
          name: labels[locale].batchDestination,
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
    async function confirm(dialog, action, locale = "zh-CN") {
      if (["trash", "purge"].includes(action))
        await dialog
          .getByRole("checkbox", {
            name: labels[locale][
              action === "trash" ? "batchTrashConfirm" : "batchPurgeConfirm"
            ],
            exact: true,
          })
          .check()
    }
    async function submitBatch(
      f,
      dialog,
      action,
      locale = "zh-CN",
      keyboard = false
    ) {
      await confirm(dialog, action, locale)
      const submission = page.waitForResponse(posted(f))
      const button = dialog.getByRole("button", {
        name: batchTitle(action, locale),
        exact: true,
      })
      await expectUI(button).toBeEnabled()
      if (keyboard) {
        await button.focus()
        await button.press("Enter")
      } else await button.click()
      const response = await submission
      expect(response.status(), await response.text()).toBe(200)
      const input = ExecuteFileBatchSchema.parse(
          response.request().postDataJSON()
        ),
        receipt = FileBatchResponseSchema.parse(await response.json())
      expect(receipt.batchId).toBe(input.batchId)
      expect(receipt.items.map((item) => item.entryId)).toEqual(
        input.items.map((item) => item.entryId)
      )
      expect(receipt.items.map((item) => item.requestedOperationId)).toEqual(
        input.items.map((item) => item.operationId)
      )
      expect(receipt.items.map((item) => item.index)).toEqual(
        input.items.map((_, index) => index)
      )
      await expectUI(dialog).toHaveCount(0)
      await expectUI(results(locale)).toContainText(input.batchId)
      return { input, receipt }
    }
    async function auditOnce(f, operationIds, eventCode) {
      const rows = (
        await environment.observer.query(
          "SELECT operation_id,count(*)::int AS total FROM audit_events WHERE organization_id=$1 AND operation_id=ANY($2::text[]) AND event_code=$3 GROUP BY operation_id",
          [f.organization.id, operationIds, eventCode]
        )
      ).rows
      expect(rows).toHaveLength(operationIds.length)
      expect(rows.every((row) => row.total === 1)).toBe(true)
    }
    async function changeRole(f, roleId, permission) {
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
            roleId,
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

    it("当前页多选正式移动、回收、原位恢复和永久删除，各根固定版本与容量一致", async () => {
      const f = await fixture(),
        target = await folder(f, "批量目标"),
        one = await upload(f, "批量一.txt"),
        two = await upload(f, "批量二.txt"),
        files = [one, two]
      await openFiles(f)
      const move = await selectBatch(files, "move")
      await chooseTarget(move, target)
      const moved = await submitBatch(f, move, "move")
      expect(moved.receipt.items.map((item) => item.state)).toEqual([
        "completed",
        "completed",
      ])
      await rows()
        .getByRole("button", { name: target.name, exact: true })
        .click()
      for (const file of files) {
        await expectUI(row(file.name)).toBeVisible()
        await fixedBytes(f, file)
        expect((await entryFacts(f, file)).path).toEqual([
          target.name,
          file.name,
        ])
      }
      const trash = await selectBatch(files, "trash")
      await expectUI(
        trash.getByRole("button", { name: batchTitle("trash"), exact: true })
      ).toBeEnabled()
      const trashed = await submitBatch(f, trash, "trash")
      expect(
        trashed.receipt.items.every((item) => item.state === "completed")
      ).toBe(true)
      await trashTab()
      const restore = await selectBatch(files, "restore")
      await expectUI(restore).toContainText(
        labels["zh-CN"].batchOriginalLocation
      )
      const restored = await submitBatch(f, restore, "restore")
      expect(
        restored.receipt.items.every((item) => item.state === "completed")
      ).toBe(true)
      await activeTab()
      await rows()
        .getByRole("button", { name: target.name, exact: true })
        .click()
      for (const file of files) {
        await expectUI(row(file.name)).toBeVisible()
        await fixedBytes(f, file)
      }
      await submitBatch(f, await selectBatch(files, "trash"), "trash")
      await trashTab()
      const before = (
        await Promise.all(files.map((file) => versionFacts(f, file)))
      ).flat()
      const purge = await selectBatch(files, "purge")
      await expectUI(purge).toContainText(labels["zh-CN"].batchPurgeConfirm)
      const purged = await submitBatch(f, purge, "purge")
      expect(
        purged.receipt.items.every((item) => item.state === "completed")
      ).toBe(true)
      for (const file of files)
        expect((await entryFacts(f, file)).state).toBe("purged")
      for (const version of before)
        expect(
          await environment.physical(
            address(f, version.storage_area, version.storage_path)
          )
        ).toBeNull()
      await usage(f, 0)
      await auditOnce(
        f,
        purged.input.items.map((item) => item.operationId),
        "file.purged"
      )
    })

    it("组织搜索中child-before-parent覆盖保持原序和原UUID，祖先与独立根各处理一次", async () => {
      const f = await fixture(),
        tree = await folder(f, "覆盖 Z父目录"),
        child = await upload(f, "覆盖 A子文件.txt", tree),
        independent = await upload(f, "覆盖 M独立.txt")
      await openFiles(f)
      await page
        .getByPlaceholder(labels["zh-CN"].searchPlaceholder, { exact: true })
        .fill("覆盖")
      await expectUI(
        page.getByRole("button", { name: "搜索", exact: true })
      ).toBeEnabled()
      await page
        .getByPlaceholder(labels["zh-CN"].searchPlaceholder, { exact: true })
        .press("Enter")
      await expectUI(page).toHaveURL(
        (url) => url.searchParams.get("name") === "覆盖"
      )
      await expectUI(row(child.name)).toBeVisible()
      const selectedOrder = await rows()
        .getByRole("row")
        .evaluateAll((rows) =>
          rows.map((row) =>
            row.querySelector("button[title]")?.getAttribute("title")
          )
        )
      const ids = new Map(
        [tree, child, independent].map((entry) => [entry.name, entry.id])
      )
      const dialog = await selectBatch([child, tree, independent], "trash")
      await expectUI(
        dialog.getByRole("list", {
          name: labels["zh-CN"].batchSelection,
          exact: true,
        })
      ).toContainText(`由“${tree.name}”一并处理`)
      const { input, receipt } = await submitBatch(f, dialog, "trash")
      expect(input.items.map((item) => item.entryId)).toEqual(
        selectedOrder.map((name) => ids.get(name))
      )
      const childIndex = input.items.findIndex(
          (item) => item.entryId === child.id
        ),
        parentIndex = input.items.findIndex((item) => item.entryId === tree.id),
        independentIndex = input.items.findIndex(
          (item) => item.entryId === independent.id
        )
      expect(childIndex).toBeLessThan(parentIndex)
      expect(receipt.items[childIndex]).toMatchObject({
        state: "covered",
        rootIndex: parentIndex,
        requestedOperationId: input.items[childIndex].operationId,
        operationId: input.items[parentIndex].operationId,
      })
      expect(receipt.items[parentIndex].operation.result.affectedEntries).toBe(
        2
      )
      expect(receipt.items[independentIndex].state).toBe("completed")
      const covered = await environment.observer.query(
        "SELECT count(*)::int AS total FROM file_operations WHERE organization_id=$1 AND id=$2",
        [f.organization.id, input.items[childIndex].operationId]
      )
      expect(covered.rows[0].total).toBe(0)
      expect(
        await environment.physical(
          address(f, "trash", [tree.id, child.fixedVersionId])
        )
      ).toEqual(child.originalBytes)
      await auditOnce(
        f,
        [input.items[parentIndex].operationId],
        "folder.trashed"
      )
      await auditOnce(
        f,
        [input.items[independentIndex].operationId],
        "file.trashed"
      )
      await usage(
        f,
        child.originalBytes.length + independent.originalBytes.length
      )
    })

    it("引用导致独立部分失败，重新核对失败项读回新revision与新UUID，旧批刷新只查询", async () => {
      const f = await fixture(),
        blocked = await upload(f, "引用失败.txt"),
        successful = await upload(f, "独立成功.txt"),
        project = await projectReference(f, blocked)
      await openFiles(f)
      const dialog = await selectBatch([blocked, successful], "trash")
      await expectUI(dialog).toContainText(
        labels["zh-CN"].batchReferencesBlocked
      )
      const first = await submitBatch(f, dialog, "trash")
      const failedIndex = first.input.items.findIndex(
          (item) => item.entryId === blocked.id
        ),
        successIndex = first.input.items.findIndex(
          (item) => item.entryId === successful.id
        )
      expect(first.receipt.items[failedIndex]).toMatchObject({
        state: "failed",
        error: { code: "FILE_REFERENCED" },
      })
      expect(first.receipt.items[successIndex].state).toBe("completed")
      expect((await entryFacts(f, blocked)).state).toBe("active")
      expect((await entryFacts(f, successful)).state).toBe("trashed")
      await clearReference(f, project)
      await native(f, `/files/entries/${blocked.id}/rename`, {
        operationId: randomUUID(),
        expectedRevision: blocked.revision,
        name: "明确新名称.txt",
      })
      const metadataReads = []
      page.on("response", (response) => {
        if (
          response.request().method() === "GET" &&
          new URL(response.url()).pathname.endsWith(
            `/files/entries/${blocked.id}`
          )
        )
          metadataReads.push(response)
      })
      await results()
        .getByRole("button", {
          name: labels["zh-CN"].batchRetryFailed,
          exact: true,
        })
        .click()
      const retry = page.getByRole("dialog", {
        name: batchTitle("trash"),
        exact: true,
      })
      await expectUI(
        retry.getByRole("list", {
          name: labels["zh-CN"].batchSelection,
          exact: true,
        })
      ).toContainText("明确新名称.txt")
      const second = await submitBatch(f, retry, "trash")
      expect(metadataReads.length).toBeGreaterThan(0)
      expect(second.input.items).toHaveLength(1)
      expect(second.input.items[0]).toMatchObject({
        entryId: blocked.id,
        expectedRevision: 2,
      })
      expect(second.input.batchId).not.toBe(first.input.batchId)
      expect(second.input.items[0].operationId).not.toBe(
        first.input.items[failedIndex].operationId
      )
      await auditOnce(
        f,
        [first.input.items[successIndex].operationId],
        "file.trashed"
      )
      const writes = [],
        reads = []
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname
        if (request.method() === "POST" && path.endsWith("/files/batches"))
          writes.push(request)
        if (request.method() === "GET" && path.includes("/files/batches/"))
          reads.push(path.split("/").at(-1))
      })
      await page
        .getByRole("navigation", {
          name: labels["zh-CN"].batchHistory,
          exact: true,
        })
        .getByRole("button", {
          name: `批次：${first.input.batchId}`,
          exact: true,
        })
        .click()
      await expectUI(results()).toContainText(first.input.batchId)
      await expectUI(results()).toContainText(labels["zh-CN"].batchFailed)
      await page.reload()
      await expectUI(results()).toContainText(second.input.batchId)
      // 当前显示的批次不写入安全记录；刷新先读最近身份，再明确选择旧批次仍只 GET。
      await page
        .getByRole("navigation", {
          name: labels["zh-CN"].batchHistory,
          exact: true,
        })
        .getByRole("button", {
          name: `批次：${first.input.batchId}`,
          exact: true,
        })
        .click()
      await expectUI(results()).toContainText(first.input.batchId)
      await expectUI(results()).toContainText(labels["zh-CN"].batchQueryOnly)
      await expectUI(
        results().getByRole("button", {
          name: labels["zh-CN"].batchContinue,
          exact: true,
        })
      ).toHaveCount(0)
      expect(writes).toHaveLength(0)
      expect(
        reads.every((id) =>
          [first.input.batchId, second.input.batchId].includes(id)
        )
      ).toBe(true)
      await usage(
        f,
        blocked.originalBytes.length + successful.originalBytes.length
      )
    })

    it("批量移动提交前真实覆盖使一个CAS失败，成功根保留且新批读当前版本后移动", async () => {
      const f = await fixture(),
        target = await folder(f, "CAS目标"),
        stale = await upload(f, "CAS旧.txt"),
        independent = await upload(f, "CAS成功.txt")
      await openFiles(f)
      const dialog = await selectBatch([stale, independent], "move")
      await chooseTarget(dialog, target)
      const replacement = await upload(
        f,
        stale.name,
        f.root,
        Buffer.from("真实当前替换字节"),
        stale
      )
      const first = await submitBatch(f, dialog, "move")
      const staleIndex = first.input.items.findIndex(
          (item) => item.entryId === stale.id
        ),
        goodIndex = first.input.items.findIndex(
          (item) => item.entryId === independent.id
        )
      expect(first.receipt.items[staleIndex]).toMatchObject({
        state: "failed",
        error: { code: "VERSION_CONFLICT" },
      })
      expect(first.receipt.items[goodIndex].state).toBe("completed")
      expect((await entryFacts(f, stale)).path).toEqual([stale.name])
      await results()
        .getByRole("button", {
          name: labels["zh-CN"].batchRetryFailed,
          exact: true,
        })
        .click()
      const retry = page.getByRole("dialog", {
        name: batchTitle("move"),
        exact: true,
      })
      await expectUI(retry).toBeVisible()
      await chooseTarget(retry, target)
      const second = await submitBatch(f, retry, "move")
      expect(second.input.items).toHaveLength(1)
      expect(second.input.items[0]).toMatchObject({
        entryId: stale.id,
        expectedRevision: replacement.revision,
      })
      expect(second.input.batchId).not.toBe(first.input.batchId)
      await fixedBytes(f, stale)
      await fixedBytes(f, replacement)
      expect(
        await environment.physical(
          address(f, "files", [target.name, stale.name])
        )
      ).toEqual(replacement.originalBytes)
      await auditOnce(
        f,
        [first.input.items[goodIndex].operationId],
        "file.moved"
      )
      await usage(
        f,
        stale.originalBytes.length +
          replacement.originalBytes.length +
          independent.originalBytes.length
      )
    })

    it("成功回程丢失后刷新仅GET同批次UUID，七字段ledger不保存选择与请求正文", async () => {
      const f = await fixture(),
        one = await upload(f, "刷新批量一.txt"),
        two = await upload(f, "刷新批量二.txt"),
        writes = [],
        reads = [],
        received = Promise.withResolvers(),
        release = Promise.withResolvers()
      await openFiles(f)
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname
        if (request.method() === "POST" && path.endsWith("/files/batches"))
          writes.push(request.postDataJSON())
        if (request.method() === "GET" && path.includes("/files/batches/"))
          reads.push(path.split("/").at(-1))
      })
      await page.route(
        `**/organizations/${f.organization.id}/files/batches`,
        async (route) => {
          const actual = await route.fetch()
          received.resolve(actual.status())
          await release.promise
          await route.abort("failed")
        },
        { times: 1 }
      )
      try {
        const dialog = await selectBatch([one, two], "trash")
        await confirm(dialog, "trash")
        await dialog
          .getByRole("button", { name: batchTitle("trash"), exact: true })
          .click()
        expect(await received.promise).toBe(200)
        const key = `files:batch:${JSON.stringify([f.owner.user.id, f.organization.id])}`
        const ledger = await page.evaluate(
          (key) => JSON.parse(sessionStorage.getItem(key)),
          key
        )
        expect(ledger).toHaveLength(1)
        expect(Object.keys(ledger[0]).sort()).toEqual(
          [
            "batchId",
            "itemOperationIds",
            "action",
            "phase",
            "submitted",
            "createdAt",
            "updatedAt",
          ].sort()
        )
        expect(ledger[0]).toMatchObject({
          batchId: writes[0].batchId,
          itemOperationIds: writes[0].items.map((item) => item.operationId),
          submitted: true,
        })
        for (const sensitive of [
          one.name,
          one.id,
          one.fixedVersionId,
          two.name,
          two.id,
          "expectedRevision",
          "parentId",
        ])
          expect(JSON.stringify(ledger)).not.toContain(sensitive)
        await page.reload()
        await expectUI(results()).toContainText(writes[0].batchId)
        await expectUI(results().locator("tbody tr")).toHaveCount(2)
        await expectUI(results()).toContainText(labels["zh-CN"].batchQueryOnly)
        await expectUI(
          results().getByRole("button", {
            name: labels["zh-CN"].batchContinue,
            exact: true,
          })
        ).toHaveCount(0)
        expect(writes).toHaveLength(1)
        expect(reads.length).toBeGreaterThan(0)
        expect(reads.every((id) => id === writes[0].batchId)).toBe(true)
        expect((await entryFacts(f, one)).state).toBe("trashed")
        expect((await entryFacts(f, two)).state).toBe("trashed")
      } finally {
        release.resolve()
        await page.unrouteAll({ behavior: "wait" })
      }
      expect(writes).toHaveLength(1)
      await usage(f, one.originalBytes.length + two.originalBytes.length)
    })

    it("Native单根撤权留下pending，明确继续原批次重用原正文、原序与原操作UUID", async () => {
      const f = await fixture(),
        target = await folder(f, "继续目标"),
        file = await upload(f, "01文件.txt"),
        source = await folder(f, "02目录"),
        writer = await signUpVerified(
          environment.baseURL,
          environment.tenantOrigin,
          environment.migrator,
          { name: "可委派批量编辑者" }
        )
      const permission = {
        file: ["read", "update"],
        folder: ["read", "update"],
      }
      const role = await environment.runtime.auth.api.createOrgRole({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          role: "batch-writer",
          permission,
        },
      })
      await environment.runtime.auth.api.addMember({
        headers: f.owner.headers,
        body: {
          organizationId: f.organization.id,
          userId: writer.user.id,
          role: "batch-writer",
        },
      })
      await openFiles(f, writer)
      const dialog = await selectBatch([file, source], "move")
      await chooseTarget(dialog, target)
      await changeRole(f, role.roleData.id, {
        file: ["read"],
        folder: ["read", "update"],
      })
      const writes = []
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname.endsWith("/files/batches")
        )
          writes.push(request.postDataJSON())
      })
      const first = await submitBatch(f, dialog, "move")
      const fileIndex = first.input.items.findIndex(
          (item) => item.entryId === file.id
        ),
        folderIndex = first.input.items.findIndex(
          (item) => item.entryId === source.id
        )
      expect(first.receipt.items[fileIndex]).toMatchObject({
        state: "unavailable",
        operation: null,
        error: { code: "FORBIDDEN" },
      })
      expect(first.receipt.items[folderIndex].state).toBe("completed")
      await expectUI(results()).toContainText(
        labels["zh-CN"].batchPollingStopped
      )
      await results()
        .getByRole("button", {
          name: labels["zh-CN"].checkOperation,
          exact: true,
        })
        .click()
      await expectUI(results()).toContainText(labels["zh-CN"].batchPending)
      expect((await entryFacts(f, file)).parent_id).toBe(f.root.id)
      expect((await entryFacts(f, source)).parent_id).toBe(target.id)
      expect(writes).toHaveLength(1)
      await changeRole(f, role.roleData.id, permission)
      const second = page.waitForResponse(posted(f))
      await results()
        .getByRole("button", {
          name: labels["zh-CN"].batchContinue,
          exact: true,
        })
        .click()
      const response = await second
      expect(response.status()).toBe(200)
      const completed = FileBatchResponseSchema.parse(await response.json())
      expect(completed.items.every((item) => item.state === "completed")).toBe(
        true
      )
      expect(writes).toEqual([first.input, first.input])
      expect(completed.items.map((item) => item.requestedOperationId)).toEqual(
        first.input.items.map((item) => item.operationId)
      )
      await auditOnce(
        f,
        [first.input.items[fileIndex].operationId],
        "file.moved"
      )
      await auditOnce(
        f,
        [first.input.items[folderIndex].operationId],
        "folder.moved"
      )
      await fixedBytes(f, file, file.originalBytes, writer)
      await usage(f, file.originalBytes.length)
    })

    it("Native只读成员无多选写控件，服务端批次POST拒绝而GET不创建计划", async () => {
      const f = await fixture(),
        one = await upload(f, "权限一.txt"),
        two = await upload(f, "权限二.txt"),
        reader = await signUpVerified(
          environment.baseURL,
          environment.tenantOrigin,
          environment.migrator,
          { name: "批量只读者" }
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
      await expectUI(row(one.name)).toBeVisible()
      await expectUI(rows().getByRole("checkbox")).toHaveCount(0)
      for (const action of ["move", "trash", "restore", "purge"])
        await expectUI(
          page.getByRole("button", { name: batchTitle(action), exact: true })
        ).toHaveCount(0)
      const body = ExecuteFileBatchSchema.parse({
        batchId: randomUUID(),
        action: "trash",
        items: [one, two].map((file) => ({
          entryId: file.id,
          expectedRevision: file.revision,
          operationId: randomUUID(),
        })),
      })
      expect(
        (await request(f, "/files/batches", json(body), reader)).status
      ).toBe(403)
      expect(
        (await request(f, `/files/batches/${body.batchId}`, {}, reader)).status
      ).toBe(404)
      expect((await entryFacts(f, one)).state).toBe("active")
      expect((await entryFacts(f, two)).state).toBe("active")
      await fixedBytes(f, one, one.originalBytes, reader)
    })

    it.each([
      { locale: "en-US", language: "English", dir: "ltr" },
      { locale: "ar", language: "العربية", dir: "rtl" },
    ])("$locale 的真实多选移动可用键盘，保持RTL与固定版本", async (input) => {
      const f = await fixture(),
        target = await folder(f, "Language target"),
        one = await upload(f, "language one.txt"),
        two = await upload(f, "language two.txt")
      await openFiles(f)
      await selectLocale(page, f.owner, input.language)
      await expectUI(page.locator("html")).toHaveAttribute("dir", input.dir)
      const dialog = await selectBatch([one, two], "move", input.locale, true)
      await chooseTarget(dialog, target, input.locale)
      const completed = await submitBatch(f, dialog, "move", input.locale, true)
      expect(
        completed.receipt.items.every((item) => item.state === "completed")
      ).toBe(true)
      await fixedBytes(f, one)
      await fixedBytes(f, two)
      expect((await entryFacts(f, one)).path).toEqual([target.name, one.name])
      await expectUI(page.locator("html")).toHaveAttribute("dir", input.dir)
    })
  }
)
