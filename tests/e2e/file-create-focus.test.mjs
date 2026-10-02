import { randomBytes, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { GenericContainer, Wait } from "testcontainers"
import { expect as expectUI } from "playwright/test"
import { afterAll, beforeAll, expect, it } from "vitest"
import {
  CreateFolderSchema,
  FileOperationResponseSchema,
} from "../../packages/contracts/dist/index.js"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const { S3Client, CreateBucketCommand } = require("@aws-sdk/client-s3")
const { FilesRuntime } = require("../../apps/api/dist/files/files-runtime.js")
const versions = JSON.parse(
  await readFile("docs/architecture/versions.json", "utf8")
)
const resources = new AsyncDisposableStack()
let environment

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
      .withWaitStrategy(Wait.forHttp("/health/ready", 9000).forStatusCode(200))
      .start()
    resources.defer(() => container.stop())
    const files = {
      kind: "s3",
      region: "us-east-1",
      endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
      bucket: `create-focus-${randomUUID()}`,
      prefix: "create-focus",
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
    environment = await startBrowserApplication({ files })
    resources.defer(() => environment.close())
  } catch (error) {
    await resources.disposeAsync()
    throw error
  }
})
afterAll(() => resources.disposeAsync())

it("真实创建完成后，当前目录列表仍在重取时恢复创建入口焦点", async () => {
  const owner = await signUpVerified(
    environment.baseURL,
    environment.tenantOrigin,
    environment.migrator,
    { name: "创建焦点验收" }
  )
  const organization = await environment.runtime.auth.api.createOrganization({
    headers: owner.headers,
    body: { name: "创建焦点组织", slug: `create-focus-${randomUUID()}` },
  })
  const organizationPath = `/api/v1/organizations/${organization.id}/files`
  const workspace = await fetch(
    environment.baseURL + organizationPath + "/workspace",
    { headers: owner.headers }
  )
  expect(workspace.status).toBe(200)
  const root = (await workspace.json()).root
  const context = await environment.browser.newContext({
    extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
  })
  let releaseList
  const listGate = new Promise((resolveGate) => {
    releaseList = resolveGate
  })
  try {
    const page = await context.newPage()
    await page.goto(environment.tenantOrigin + "/app/")
    await page.getByLabel("邮箱", { exact: true }).fill(owner.email)
    await page.getByLabel("密码", { exact: true }).fill(owner.password)
    await page.getByRole("button", { name: "登录", exact: true }).click()
    await page.getByRole("link", { name: "文件", exact: true }).click()
    const opener = page.getByRole("button", {
      name: "创建文件夹",
      exact: true,
    })
    await expectUI(opener).toBeEnabled()
    await opener.click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("textbox").fill("焦点验收目录")
    await expectUI(dialog).toHaveCSS("opacity", "1")
    const observedRequests = []
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname
      if (
        pathname.startsWith(organizationPath) ||
        pathname.endsWith("/has-permission")
      )
        observedRequests.push({ method: request.method(), pathname })
    })
    let listReceived
    const listFetched = new Promise((resolveFetch) => {
      listReceived = resolveFetch
    })
    let listReleased = false
    // 保留真实 GET 的内容，只控制其送回浏览器的时间，检验独立于列表响应速度的 Dialog 焦点契约。
    await page.route(
      (url) => url.pathname === organizationPath,
      async (route) => {
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        listReceived()
        await listGate
        listReleased = true
        await route.fulfill({ response })
      }
    )
    const submitted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === organizationPath + "/folders"
    )
    await dialog
      .getByRole("button", { name: "创建文件夹", exact: true })
      .click()
    const response = await submitted
    expect(response.status()).toBe(200)
    const input = CreateFolderSchema.parse(response.request().postDataJSON())
    const receipt = FileOperationResponseSchema.parse(await response.json())
    expect(input.parentId).toBe(root.id)
    expect(receipt).toMatchObject({ id: input.operationId, phase: "completed" })
    await listFetched
    await expectUI(dialog).toHaveCount(0)
    expect(listReleased).toBe(false)
    await expectUI(opener).toBeEnabled()
    await expectUI(opener).toBeFocused()
    expect(
      await environment.app
        .get(FilesRuntime)
        .requireStorage()
        .directoryExists({
          owner: { kind: "organization", id: organization.id },
          area: "files",
          segments: ["焦点验收目录"],
        })
    ).toBe(true)
    expect(
      observedRequests.filter(
        (request) =>
          request.method === "POST" && request.pathname.endsWith("/folders")
      )
    ).toHaveLength(1)
    expect(
      observedRequests.filter((request) =>
        request.pathname.endsWith("/has-permission")
      )
    ).toHaveLength(0)
    releaseList()
    await expectUI(
      page.getByRole("button", { name: "焦点验收目录", exact: true })
    ).toBeVisible()
  } finally {
    releaseList()
    await context.close()
  }
})
