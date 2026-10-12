import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
const jobRequire = createRequire(
  new URL("../../packages/jobs/package.json", import.meta.url)
)
const ExcelJS = jobRequire("exceljs")
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { startTestApplication } from "../setup/test-runtime.mjs"

describe("Projects 导入导出：正式 HTTP 与持久任务", () => {
  let environment, user, organization
  const origin = "http://localhost:3200"
  beforeAll(async () => {
    environment = await startTestApplication()
    user = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator,
      {
        name: "Exchange owner",
        email: `exchange-${randomUUID()}@example.com`,
        origin,
      }
    )
    organization = await environment.runtime.auth.api.createOrganization({
      headers: user.headers,
      body: { name: "Exchange organization", slug: `exchange-${randomUUID()}` },
    })
  })
  afterAll(async () => environment?.close())
  test("排队后撤销项目动作时持久拒绝任务，恢复权限不重做旧任务", async () => {
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const role = (
      await environment.runtime.auth.api.createOrgRole({
        headers: user.headers,
        body: {
          organizationId: organization.id,
          role: "exchange-" + randomUUID().slice(0, 8),
          permission: { project: ["export"] },
        },
      })
    ).roleData
    await environment.runtime.auth.api.addMember({
      headers: user.headers,
      body: {
        organizationId: organization.id,
        userId: actor.user.id,
        role: role.role,
      },
    })
    const key = randomUUID()
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(actor.headers),
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ format: "csv", filter: {} }),
      }
    )
    expect(response.status).toBe(202)
    const task = await response.json()
    const headers = new Headers(user.headers)
    const version = await environment.observer.query(
      "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
      [organization.id]
    )
    headers.set(
      "X-Expected-Authz-Version",
      String(version.rows[0].authorization_version)
    )
    await environment.runtime.auth.api.updateOrgRole({
      headers,
      body: {
        organizationId: organization.id,
        roleId: role.id,
        data: { permission: { project: ["read"] } },
      },
    })
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    try {
      let result
      await expect
        .poll(
          async () => {
            const read = await fetch(
              `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
              { headers: user.headers }
            )
            result = await read.json()
            return result.status
          },
          { timeout: 10000 }
        )
        .toBe("rejected")
      expect(result.errorCode).toBe("PERMISSION_DENIED")
      expect(result.resultAvailable).toBe(false)
      const latest = await environment.observer.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
        [organization.id]
      )
      headers.set(
        "X-Expected-Authz-Version",
        String(latest.rows[0].authorization_version)
      )
      await environment.runtime.auth.api.updateOrgRole({
        headers,
        body: {
          organizationId: organization.id,
          roleId: role.id,
          data: { permission: { project: ["export"] } },
        },
      })
      const repeated = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(actor.headers),
            "content-type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ format: "csv", filter: {} }),
        }
      )
      expect(repeated.status).toBe(202)
      expect(await repeated.json()).toMatchObject({
        id: task.id,
        status: "rejected",
        resultAvailable: false,
      })
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  })
  test("提交意图后队列未确认，正常 Worker 自动恢复执行", async () => {
    const { createApplication } = createRequire(import.meta.url)(
      "../../apps/api/dist/create-application.js"
    )
    const app = await createApplication(environment.config, {
      logger: ["error"],
    })
    const { businessWorkerConfig } = createRequire(import.meta.url)(
      "../../apps/api/dist/business/business-config.js"
    )
    app.get(businessWorkerConfig).redisUrl = "redis://127.0.0.1:1"
    await app.listen(0, "127.0.0.1")
    const baseURL = await app.getUrl()
    let worker, closed
    try {
      const response = await fetch(
        `${baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(user.headers),
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ format: "csv", filter: {} }),
        }
      )
      expect(response.status).toBe(202)
      const task = await response.json()
      expect(task.status).toBe("submitted")
      worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
        env: {
          ...process.env,
          DATABASE_URL: environment.config.databaseURL,
          REDIS_URL: environment.config.redisURL,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      closed = new Promise((resolve) => worker.once("exit", resolve))
      await expect
        .poll(
          async () => {
            const read = await fetch(
              `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
              { headers: user.headers }
            )
            return (await read.json()).status
          },
          { timeout: 10000 }
        )
        .toBe("completed")
    } finally {
      if (worker) {
        worker.kill("SIGTERM")
        await closed
      }
      await app.close()
    }
  })
  test("Projects 真实变更在同一事务建立薄Webhook投递事件", async () => {
    const path = `${environment.baseURL}/api/v1/organizations/${organization.id}`
    const headers = {
      ...Object.fromEntries(user.headers),
      "content-type": "application/json",
    }
    const endpoint = await fetch(`${path}/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Projects events",
        url: "http://127.0.0.1:9/events",
        events: ["project.created", "project.updated", "project.deleted"],
      }),
    })
    expect(endpoint.status).toBe(201)
    const webhook = await endpoint.json()
    const created = await fetch(`${path}/projects`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Event reference",
        description: null,
        contentLocale: "zh-CN",
      }),
    })
    expect(created.status).toBe(201)
    const project = await created.json()
    const readEvents = () =>
      fetch(`${path}/webhooks/${webhook.id}/deliveries`, {
        headers: user.headers,
      }).then((response) => response.json())
    expect((await readEvents()).items.map((item) => item.eventType)).toEqual([
      "project.created",
    ])
    const updated = await fetch(`${path}/projects/${project.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "archived" }),
    })
    expect(updated.status).toBe(200)
    const translated = await fetch(`${path}/projects/${project.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        translation: { locale: "ar", name: "ترجمة", description: null },
      }),
    })
    expect(translated.status).toBe(200)
    const deleted = await fetch(`${path}/projects/${project.id}`, {
      method: "DELETE",
      headers,
    })
    expect(deleted.status).toBe(204)
    expect(
      (await readEvents()).items.map((item) => item.eventType).sort()
    ).toEqual([
      "project.created",
      "project.deleted",
      "project.updated",
      "project.updated",
    ])
  })
  test("HTTP 初检后角色先撤权，提交事务必须拒绝且不创建业务任务", async () => {
    const actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const role = (
      await environment.runtime.auth.api.createOrgRole({
        headers: user.headers,
        body: {
          organizationId: organization.id,
          role: `race-${randomUUID().slice(0, 8)}`,
          permission: { project: ["export"] },
        },
      })
    ).roleData
    await environment.runtime.auth.api.addMember({
      headers: user.headers,
      body: {
        organizationId: organization.id,
        userId: actor.user.id,
        role: role.role,
      },
    })
    const held = await environment.runtime.pool.connect()
    let revoke, submitted
    try {
      await held.query("BEGIN")
      const version = await held.query(
        "SELECT authorization_version FROM organization_status WHERE organization_id=$1 FOR UPDATE",
        [organization.id]
      )
      const headers = new Headers(user.headers)
      headers.set(
        "X-Expected-Authz-Version",
        String(version.rows[0].authorization_version)
      )
      revoke = environment.runtime.auth.api.updateOrgRole({
        headers,
        body: {
          organizationId: organization.id,
          roleId: role.id,
          data: { permission: { project: ["read"] } },
        },
      })
      const waiting = async () =>
        (
          await environment.observer.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE query LIKE '%require_active_organization%' AND wait_event_type='Lock' AND datname=current_database()"
          )
        ).rows[0].count
      await expect.poll(waiting).toBe(1)
      submitted = fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(actor.headers),
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ format: "csv", filter: {} }),
        }
      )
      await expect.poll(waiting).toBe(2)
      await held.query("COMMIT")
      await revoke
      const response = await submitted
      expect(response.status).toBe(403)
      expect((await response.json()).code).toBe("FORBIDDEN")
      const history = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks`,
        { headers: actor.headers }
      ).then((value) => value.json())
      expect(history.items).toEqual([])
    } finally {
      await held.query("ROLLBACK")
      held.release()
      await revoke
      await submitted
    }
  })
  test("任务中心从已授权持久历史读取业务任务，保留来源与状态", async () => {
    const task = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(user.headers),
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ format: "csv", filter: {} }),
      }
    )
    expect(task.status).toBe(202)
    const record = await task.json()
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/task-center`,
      { headers: user.headers }
    )
    expect(response.status).toBe(200)
    expect((await response.json()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: record.id,
          source: "business",
          actorId: user.user.id,
          type: "projects.export",
        }),
      ])
    )
  })

  test("XLSX 合法行通过正式 Worker 一次提交为两个新项目", async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet("Projects").addRows([
      ["name", "description", "contentLocale"],
      ["Xlsx 一", "第一条描述", "zh-CN"],
      ["Xlsx 二", "", "ar"],
    ])
    const contentBase64 = Buffer.from(
      await workbook.xlsx.writeBuffer()
    ).toString("base64")
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    worker.stdout.on("data", (chunk) => {
      output += chunk
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    try {
      await expect
        .poll(() => output.includes('"event":"worker_ready"'), {
          timeout: 10000,
        })
        .toBe(true)
      const response = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/imports`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(user.headers),
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({ format: "xlsx", contentBase64 }),
        }
      )
      expect(response.status).toBe(202)
      const task = await response.json()
      let completed
      await expect
        .poll(
          async () => {
            const read = await fetch(
              `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
              { headers: user.headers }
            )
            completed = await read.json()
            return completed.status
          },
          { timeout: 10000 }
        )
        .toBe("completed")
      expect(completed.result).toEqual({ count: 2, issues: [] })
      const result = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects?name=Xlsx`,
        { headers: user.headers }
      )
      expect(
        (await result.json()).items.map((item) => item.name).sort()
      ).toEqual(["Xlsx 一", "Xlsx 二"])
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  })

  test("CSV 新增保持引号换行与语言，XLSX 导出包含全部筛选记录", async () => {
    const path = `${environment.baseURL}/api/v1/organizations/${organization.id}`
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    const headers = {
      ...Object.fromEntries(user.headers),
      "content-type": "application/json",
      "Idempotency-Key": randomUUID(),
    }
    const terminal = async (id) => {
      let task
      await expect
        .poll(
          async () => {
            task = await fetch(`${path}/tasks/${id}`, {
              headers: user.headers,
            }).then((response) => response.json())
            return task.status
          },
          { timeout: 10000 }
        )
        .toBe("completed")
      return task
    }
    try {
      const csv =
        'contentLocale,name,description\nzh-CN,"CSV reference, \""quoted\""","line one\nline two"\nar,CSV reference Arabic,\n'
      const imported = await fetch(`${path}/projects/imports`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          format: "csv",
          contentBase64: Buffer.from(csv).toString("base64"),
        }),
      })
      expect(imported.status).toBe(202)
      expect((await terminal((await imported.json()).id)).result).toEqual({
        count: 2,
        issues: [],
      })
      const exported = await fetch(`${path}/projects/exports`, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": randomUUID() },
        body: JSON.stringify({
          format: "xlsx",
          filter: { name: "CSV reference" },
        }),
      })
      expect(exported.status).toBe(202)
      const task = await exported.json()
      expect((await terminal(task.id)).result.count).toBe(2)
      const result = await fetch(`${path}/tasks/${task.id}/result`, {
        headers: user.headers,
      })
      expect(result.status).toBe(200)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await result.arrayBuffer())
      const sheet = workbook.worksheets[0]
      expect(sheet.getRow(1).values.slice(1)).toEqual([
        "name",
        "description",
        "contentLocale",
      ])
      const rows = [
        sheet.getRow(2).values.slice(1),
        sheet.getRow(3).values.slice(1),
      ]
      expect(rows).toEqual(
        expect.arrayContaining([
          ['CSV reference, "quoted"', "line one\nline two", "zh-CN"],
          ["CSV reference Arabic", "", "ar"],
        ])
      )
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  })
  test("组织 owner 可以按当前筛选提交导出并取得可查询的任务身份", async () => {
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(user.headers),
          "content-type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ format: "csv", filter: {} }),
      }
    )
    expect(response.status).toBe(202)
    const task = await response.json()
    expect(task).toMatchObject({
      type: "projects.export",
      organizationId: organization.id,
    })
    const read = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
      { headers: user.headers }
    )
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({
      id: task.id,
      type: "projects.export",
    })
  })

  test("正式独立 Worker 导出全部筛选结果，结果只通过受保护 HTTP 下载", async () => {
    const project = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organization.id}/projects`,
      {
        method: "POST",
        headers: {
          ...Object.fromEntries(user.headers),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: 'Export "quoted", project',
          description: "line one\nline two",
          contentLocale: "en-US",
        }),
      }
    )
    expect(project.status).toBe(201)
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    worker.stdout.on("data", (chunk) => {
      output += chunk
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    try {
      await expect
        .poll(() => output.includes('"event":"worker_ready"'), {
          timeout: 10000,
        })
        .toBe(true)
      const response = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/exports`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(user.headers),
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
            "Accept-Language": "en-US",
          },
          body: JSON.stringify({ format: "csv", filter: { name: "quoted" } }),
        }
      )
      expect(response.status).toBe(202)
      const task = await response.json()
      await expect
        .poll(
          async () => {
            const result = await fetch(
              `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
              { headers: user.headers }
            )
            return (await result.json()).status
          },
          { timeout: 10000 }
        )
        .toBe("completed")
      const download = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}/result`,
        { headers: user.headers }
      )
      expect(download.status).toBe(200)
      expect(await download.text()).toContain('"Export ""quoted"", project"')
      const anonymous = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}/result`
      )
      expect(anonymous.status).toBe(401)
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  })

  test("导入出现坏行时整批拒绝，持久报告包含字段和行号且不创建合法行", async () => {
    const worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    worker.stdout.on("data", (chunk) => {
      output += chunk
    })
    const closed = new Promise((resolve) => worker.once("exit", resolve))
    try {
      await expect
        .poll(() => output.includes('"event":"worker_ready"'), {
          timeout: 10000,
        })
        .toBe(true)
      const content =
        "name,description,contentLocale\nAtomic valid,valid,en-US\nAtomic invalid,bad,xx\n"
      const response = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects/imports`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(user.headers),
            "content-type": "application/json",
            "Idempotency-Key": randomUUID(),
          },
          body: JSON.stringify({
            format: "csv",
            contentBase64: Buffer.from(content).toString("base64"),
          }),
        }
      )
      expect(response.status).toBe(202)
      const task = await response.json()
      let completed
      await expect
        .poll(
          async () => {
            const read = await fetch(
              `${environment.baseURL}/api/v1/organizations/${organization.id}/tasks/${task.id}`,
              { headers: user.headers }
            )
            completed = await read.json()
            return completed.status
          },
          { timeout: 10000 }
        )
        .toBe("failed")
      expect(completed.result).toEqual({
        count: 0,
        issues: [{ row: 3, field: "contentLocale", code: "INVALID_LOCALE" }],
      })
      const projects = await fetch(
        `${environment.baseURL}/api/v1/organizations/${organization.id}/projects?name=Atomic`,
        { headers: user.headers }
      )
      expect((await projects.json()).items).toEqual([])
    } finally {
      worker.kill("SIGTERM")
      await closed
    }
  })
})
