import { randomBytes, randomUUID, webcrypto } from "node:crypto"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { beforeAll, afterAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startBrowserApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"
const jobRequire = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)
const ExcelJS = jobRequire("exceljs")
const { parse } = jobRequire("csv-parse/sync")
const require = createRequire(import.meta.url)
const {
  WebhookDelivery,
} = require("../../apps/api/dist/webhooks/webhook-delivery.js")

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
describe("通用能力正式浏览器、Worker和外部接收端", () => {
  let environment, worker, closed
  beforeAll(async () => {
    environment = await startBrowserApplication({ mail: true })
    worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    closed = new Promise((resolve) => worker.once("exit", resolve))
    worker.stdout.resume()
    worker.stderr.resume()
  })
  afterAll(async () => {
    if (worker) {
      worker.kill("SIGTERM")
      await closed
    }
    await environment?.close()
  })
  async function prepare() {
    const actor = await signUpVerified(
      environment.baseURL,
      environment.tenantOrigin,
      environment.migrator
    )
    const organization = await environment.runtime.auth.api.createOrganization({
      headers: actor.headers,
      body: {
        name: "浏览器框架验收",
        slug: `browser-framework-${randomUUID()}`,
      },
    })
    const context = await environment.browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "x-real-ip": `10.${[...randomBytes(3)].join(".")}` },
    })
    await attach(context, actor.cookie, environment.tenantOrigin)
    const page = await context.newPage()
    await page.goto(
      `${environment.tenantOrigin}/app/projects/${organization.id}`
    )
    await expectUI(
      page.getByRole("button", { name: "导入项目", exact: true })
    ).toBeVisible()
    return { actor, organization, context, page }
  }
  async function submit(page, organization, kind, file, format = "csv") {
    await page
      .getByRole("button", {
        name: kind === "import" ? "导入项目" : "导出项目",
        exact: true,
      })
      .click()
    const form = page.getByRole("dialog")
    if (format === "xlsx") {
      await form.getByRole("combobox", { name: "格式", exact: true }).click()
      await page.getByRole("option", { name: "XLSX", exact: true }).click()
    }
    if (file) await form.getByLabel("文件", { exact: true }).setInputFiles(file)
    await form
      .getByRole("button", {
        name: kind === "import" ? "提交导入" : "提交导出",
        exact: true,
      })
      .click()
    await expectUI(page).toHaveURL(
      new RegExp(`/app/tasks/${organization.id}\\?`)
    )
    const id = new URL(page.url()).searchParams.get("taskId")
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    return id
  }
  async function closeDetail(page) {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click()
    await expectUI(page.getByRole("dialog")).toHaveCount(0)
  }
  it("CSV与XLSX新增、坏行整批零新增，真实任务通知能标已读并回到详情", async () => {
    const { actor, organization, context, page } = await prepare()
    try {
      const id = await submit(page, organization, "import", {
        name: "projects.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "name,description,contentLocale\n浏览器CSV项目,说明,zh-CN\n"
        ),
      })
      await expectUI(
        page.getByRole("dialog").getByText("已完成", { exact: true })
      ).toBeVisible({ timeout: 15000 })
      await closeDetail(page)
      await page.getByRole("link", { name: "通知", exact: true }).click()
      await expectUI(
        page.getByRole("heading", { name: "通知", exact: true })
      ).toBeVisible()
      await expectUI(
        page.getByRole("button", { name: "项目导入已完成", exact: true })
      ).toBeVisible()
      await page.getByRole("button", { name: "标为已读", exact: true }).click()
      await expectUI(page.getByText("0 条未读", { exact: true })).toBeVisible()
      await page
        .getByRole("button", { name: "项目导入已完成", exact: true })
        .click()
      await expectUI(page).toHaveURL(new RegExp(`taskId=${id}`))
      await expectUI(
        page.getByRole("dialog").getByText("已完成", { exact: true })
      ).toBeVisible()
      await closeDetail(page)
      await page.goto(
        `${environment.tenantOrigin}/app/projects/${organization.id}`
      )
      const book = new ExcelJS.Workbook()
      book.addWorksheet("Projects").addRows([
        ["name", "description", "contentLocale"],
        ["浏览器XLSX项目", null, "zh-CN"],
      ])
      await submit(
        page,
        organization,
        "import",
        {
          name: "projects.xlsx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from(await book.xlsx.writeBuffer()),
        },
        "xlsx"
      )
      await expectUI(
        page.getByRole("dialog").getByText("已完成", { exact: true })
      ).toBeVisible({ timeout: 15000 })
      await closeDetail(page)
      await page.goto(
        `${environment.tenantOrigin}/app/projects/${organization.id}`
      )
      await submit(page, organization, "import", {
        name: "invalid.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          "name,description,contentLocale\n不应保存,说明,zh-CN\n,坏行,zh-CN\n"
        ),
      })
      const report = page.getByRole("dialog")
      await expectUI(report.getByText("名称无效", { exact: true })).toBeVisible(
        { timeout: 15000 }
      )
      await expectUI(
        report.getByText("没有新增任何项目。", { exact: true })
      ).toBeVisible()
      const result = await environment.observer.query(
        "SELECT count(*)::int AS count FROM projects WHERE organization_id=$1",
        [organization.id]
      )
      expect(result.rows[0].count).toBe(2)
      const messages = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/notifications`,
        { headers: actor.headers }
      )
      expect(messages.status).toBe(200)
      expect((await messages.json()).items.map((item) => item.type)).toContain(
        "task.failed"
      )
    } finally {
      await context.close()
    }
  })
  it("当前筛选跨页导出CSV与XLSX，浏览器下载真实授权字节", async () => {
    const { organization, context, page } = await prepare()
    try {
      const rows = Array.from(
        { length: 25 },
        (_, index) => `导出目标${index},说明,zh-CN`
      )
      await submit(page, organization, "import", {
        name: "all.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          [
            "name,description,contentLocale",
            ...rows,
            "其他项目,说明,zh-CN",
          ].join("\n")
        ),
      })
      await expectUI(
        page.getByRole("dialog").getByText("已完成", { exact: true })
      ).toBeVisible({ timeout: 15000 })
      await closeDetail(page)
      for (const format of ["csv", "xlsx"]) {
        await page.goto(
          `${environment.tenantOrigin}/app/projects/${organization.id}`
        )
        await expectUI(page.getByRole("table")).toHaveAttribute(
          "aria-busy",
          "false"
        )
        await page
          .getByPlaceholder("搜索项目名称", { exact: true })
          .fill("导出目标")
        await expectUI(
          page.getByPlaceholder("搜索项目名称", { exact: true })
        ).toHaveValue("导出目标")
        await page.getByRole("button", { name: "搜索", exact: true }).click()
        await expectUI(page).toHaveURL(/name=/)
        const taskId = await submit(
          page,
          organization,
          "export",
          undefined,
          format
        )
        const detail = page.getByRole("dialog")
        await expectUI(detail.getByText("已完成", { exact: true })).toBeVisible(
          { timeout: 15000 }
        )
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          detail.getByRole("button", { name: "下载结果", exact: true }).click(),
        ])
        expect(download.suggestedFilename()).toBe(`task-${taskId}.${format}`)
        const bytes = await readFile(await download.path())
        let names
        if (format === "csv")
          names = parse(bytes, { columns: true }).map((row) => row.name)
        else {
          const workbook = new ExcelJS.Workbook()
          await workbook.xlsx.load(bytes)
          names = workbook.worksheets[0].getColumn(1).values.slice(2)
        }
        expect(names).toHaveLength(25)
        expect(names.every((name) => name.startsWith("导出目标"))).toBe(true)
        await closeDetail(page)
      }
    } finally {
      await context.close()
    }
  })
  it("真实页面创建Webhook，正式Project事件经公共dispatcher送达本地接收端并显示投递日志", async () => {
    const received = []
    const receiver = createServer(async (request, response) => {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      received.push({
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      })
      response.writeHead(204).end()
    })
    await new Promise((resolve) => receiver.listen(0, "127.0.0.1", resolve))
    const { actor, organization, context, page } = await prepare()
    try {
      await page
        .getByRole("navigation", { name: "主导航", exact: true })
        .getByRole("link", { name: "组织管理", exact: true })
        .click()
      await page
        .getByRole("navigation", { name: "组织管理", exact: true })
        .getByRole("link", { name: "API Key 与 Webhook", exact: true })
        .click()
      await page
        .getByRole("button", { name: "创建 Webhook", exact: true })
        .click()
      const form = page.getByRole("dialog")
      await form.getByLabel("名称", { exact: true }).fill("本地事件接收端")
      await form
        .getByLabel("接收地址", { exact: true })
        .fill(`http://127.0.0.1:${receiver.address().port}/events`)
      await form
        .getByRole("checkbox", { name: "项目已创建", exact: true })
        .check()
      await form
        .getByRole("button", { name: "保存 Webhook", exact: true })
        .click()
      const secret = await page
        .getByLabel("签名密钥", { exact: true })
        .inputValue()
      expect(secret.startsWith("whsec_")).toBe(true)
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click()
      await expectUI(page.getByLabel("签名密钥", { exact: true })).toHaveCount(
        0
      )
      const create = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(actor.headers),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "薄事件项目",
            description: "不应发送的项目内容",
            contentLocale: "zh-CN",
          }),
        }
      )
      expect(create.status).toBe(201)
      const project = await create.json()
      // 只驱动本地测试接收端的公开投递接口，生产main的启动与目标授权由根任务独立接线。
      await environment.app.get(WebhookDelivery).dispatchOne()
      await expect.poll(() => received.length, { timeout: 3000 }).toBe(1)
      const message = received[0],
        body = JSON.parse(message.body)
      expect(body.resourceId).toBe(project.id)
      expect(body.organizationId).toBe(organization.id)
      expect(body.type).toBe("project.created")
      expect(message.body).not.toContain("不应发送的项目内容")
      const key = await webcrypto.subtle.importKey(
        "raw",
        Buffer.from(secret.slice(6), "base64"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
      )
      expect(
        await webcrypto.subtle.verify(
          "HMAC",
          key,
          Buffer.from(message.headers["webhook-signature"].slice(3), "base64"),
          Buffer.from(
            `${body.id}.${message.headers["webhook-timestamp"]}.${message.body}`
          )
        )
      ).toBe(true)
      await page.getByRole("button", { name: "投递记录", exact: true }).click()
      const history = page.getByRole("dialog")
      await expectUI(history.getByText("已投递", { exact: true })).toBeVisible()
      await expectUI(history.getByText("204", { exact: true })).toBeVisible()
      await history.getByRole("button", { name: "关闭", exact: true }).click()
      await page
        .getByRole("button", { name: "删除 Webhook", exact: true })
        .click()
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "删除 Webhook", exact: true })
        .click()
      await expectUI(
        page.getByText("本地事件接收端", { exact: true })
      ).toHaveCount(0)
    } finally {
      await context.close()
      await new Promise((resolve) => receiver.close(resolve))
    }
  })
})
