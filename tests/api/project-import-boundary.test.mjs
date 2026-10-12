import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { beforeAll, afterAll, expect, test } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

const ExcelJS = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)("exceljs")
let environment, actor, organization, worker, closed
const prefix = () =>
  `${environment.baseURL}/api/v1/organizations/${organization.id}`
beforeAll(async () => {
  environment = await startTestApplication()
  actor = await signUpVerified(
    environment.baseURL,
    "http://localhost:3200",
    environment.migrator
  )
  organization = await environment.runtime.auth.api.createOrganization({
    headers: actor.headers,
    body: { name: "导入文件边界", slug: randomUUID() },
  })
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
  worker?.kill("SIGTERM")
  await closed
  await environment?.close()
})
const submit = (format, bytes) =>
  fetch(`${prefix()}/projects/imports`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(actor.headers),
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({ format, contentBase64: bytes.toString("base64") }),
  })
async function terminal(id, status) {
  let result
  await expect
    .poll(
      async () => {
        const read = await fetch(`${prefix()}/tasks/${id}`, {
          headers: actor.headers,
        })
        expect(read.status).toBe(200)
        result = await read.json()
        return result.status
      },
      { timeout: 20000 }
    )
    .toBe(status)
  return result
}
test("多工作表 XLSX 整批拒绝，返回明确报告并且没有新增项目", async () => {
  const workbook = new ExcelJS.Workbook()
  for (const name of ["first", "second"]) {
    const sheet = workbook.addWorksheet(name)
    sheet.addRow(["name", "description", "contentLocale"])
    sheet.addRow([name, "不可只导入第一张", "zh-CN"])
  }
  const response = await submit(
    "xlsx",
    Buffer.from(await workbook.xlsx.writeBuffer())
  )
  expect(response.status).toBe(202)
  const task = await terminal((await response.json()).id, "failed")
  expect(task.result).toEqual({
    count: 0,
    issues: [{ row: 1, field: "file", code: "INVALID_WORKSHEET_COUNT" }],
  })
  const projects = await fetch(`${prefix()}/projects`, {
    headers: actor.headers,
  })
  expect((await projects.json()).total).toBe(0)
})
test("原始 10 MB CSV 可经正式 JSON、Redis 和 Worker 完整导入", async () => {
  const head = "name,description,contentLocale\nmaximum-file,"
  const tail = ",zh-CN\n"
  const csv = Buffer.from(
    head + "x".repeat(10_000_000 - head.length - tail.length) + tail
  )
  expect(csv.byteLength).toBe(10_000_000)
  const response = await submit("csv", csv)
  expect(response.status).toBe(202)
  const task = await terminal((await response.json()).id, "completed")
  expect(task.result).toEqual({ count: 1, issues: [] })
  const projects = await fetch(`${prefix()}/projects?name=maximum-file`, {
    headers: actor.headers,
  })
  const data = await projects.json()
  expect(data.total).toBe(1)
  expect(data.items[0].description.length).toBe(
    10_000_000 - head.length - tail.length
  )
})
test.each(["csv", "xlsx"])(
  "%s 超出原始 10 MB 一个字节在受理前拒绝",
  async (format) => {
    const before = await environment.observer.query(
      "SELECT count(*)::int AS count FROM business_tasks"
    )
    const response = await submit(format, Buffer.alloc(10_000_001, "x"))
    expect(response.status).toBe(400)
    const after = await environment.observer.query(
      "SELECT count(*)::int AS count FROM business_tasks"
    )
    expect(after.rows[0].count).toBe(before.rows[0].count)
  }
)
test("普通 Projects JSON 仍保留原来的请求体上限", async () => {
  const response = await fetch(`${prefix()}/projects`, {
    method: "POST",
    headers: {
      ...Object.fromEntries(actor.headers),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "ordinary-request",
      description: "x".repeat(150_000),
      contentLocale: "zh-CN",
    }),
  })
  expect(response.status).toBe(413)
})

test.each([
  [
    "空行后的坏记录",
    "name,description,contentLocale\nvalid,,en-US\n\nbad,,xx\n",
    4,
  ],
  [
    "前一个字段含换行",
    'name,description,contentLocale\nvalid,"first\nsecond",en-US\nbad,,xx\n',
    4,
  ],
  [
    "坏记录自身含换行",
    'name,description,contentLocale\nbad,"first\nsecond",xx\n',
    2,
  ],
])("CSV %s 报告原文本中记录的起始行", async (_name, csv, row) => {
  const response = await submit("csv", Buffer.from(csv))
  expect(response.status).toBe(202)
  const task = await terminal((await response.json()).id, "failed")
  expect(task.result).toEqual({
    count: 0,
    issues: [{ row, field: "contentLocale", code: "INVALID_LOCALE" }],
  })
  const projects = await fetch(`${prefix()}/projects?name=valid`, {
    headers: actor.headers,
  })
  expect((await projects.json()).total).toBe(0)
})
