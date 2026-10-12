import { spawn } from "node:child_process"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const {
  NotificationEmailDelivery,
} = require("../../apps/api/dist/notifications/notification-email-delivery.js")
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  BusinessTaskSchema,
  NotificationPreferencesSchema,
  NotificationPageSchema,
  NotificationSchema,
} from "../../packages/contracts/dist/index.js"
import { startTestApplication } from "../setup/test-runtime.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

describe("成员通知公开HTTP", () => {
  let environment
  let actor
  let organizationId
  let worker, workerClosed
  const origin = "http://localhost:3200"
  beforeAll(async () => {
    environment = await startTestApplication({ origins: [origin], mail: true })
    actor = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const response = await fetch(
      `${environment.baseURL}/api/auth/organization/create`,
      {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "通知组织",
          slug: `notification-${actor.user.id}`,
        }),
      }
    )
    expect(response.status).toBe(200)
    organizationId = (await response.json()).id
  })
  afterAll(async () => {
    await stopWorker()
    await environment?.close()
  })
  const path = () =>
    `${environment.baseURL}/api/v1/organizations/${organizationId}`
  const delivery = () => environment.app.get(NotificationEmailDelivery)
  async function stopWorker() {
    if (!worker) return
    worker.kill("SIGTERM")
    await workerClosed
    worker = undefined
  }
  async function execute(task, status = "completed") {
    // 前置授权变化完成后才启动Worker，真正消费Redis意图并持久结算终态。
    worker = spawn(process.execPath, ["apps/worker/dist/main.js"], {
      env: {
        ...process.env,
        DATABASE_URL: environment.config.databaseURL,
        REDIS_URL: environment.config.redisURL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    worker.stdout.resume()
    worker.stderr.resume()
    workerClosed = new Promise((resolve) => worker.once("exit", resolve))
    let terminal
    try {
      await expect
        .poll(
          async () => {
            const response = await fetch(`${path()}/tasks/${task.id}`, {
              headers: actor.headers,
            })
            expect(response.status).toBe(200)
            terminal = BusinessTaskSchema.parse(await response.json())
            return terminal.status
          },
          { timeout: 15000 }
        )
        .toBe(status)
      return terminal
    } finally {
      await stopWorker()
    }
  }
  async function submit(kind, body, recipient = actor) {
    const response = await fetch(`${path()}/projects/${kind}`, {
      method: "POST",
      headers: {
        ...Object.fromEntries(recipient.headers),
        "content-type": "application/json",
        "Accept-Language": "zh-CN",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(202)
    return BusinessTaskSchema.parse(await response.json())
  }
  const exportTask = (recipient = actor) =>
    submit("exports", { format: "csv", filter: {} }, recipient)
  async function preferences(emailEnabled, recipient = actor) {
    const response = await fetch(`${path()}/notification-preferences`, {
      method: "PUT",
      headers: {
        ...Object.fromEntries(recipient.headers),
        "content-type": "application/json",
      },
      body: JSON.stringify({ emailEnabled }),
    })
    expect(response.status).toBe(200)
    expect(NotificationPreferencesSchema.parse(await response.json())).toEqual({
      emailEnabled,
    })
  }
  async function list(recipient = actor) {
    const response = await fetch(
      `${path()}/notifications?page=1&pageSize=100`,
      {
        headers: recipient.headers,
      }
    )
    expect(response.status).toBe(200)
    return NotificationPageSchema.parse(await response.json())
  }
  async function emailFact(taskId) {
    const facts = await environment.observer.query(
      "SELECT id,recipient_id,type,email_status,email_attempts FROM business_notifications WHERE task_id=$1",
      [taskId]
    )
    expect(facts.rows).toHaveLength(1)
    return facts.rows[0]
  }
  async function taskMessages(taskId) {
    const listed = await (
      await fetch(`${environment.mailpitOrigin}/api/v1/messages`)
    ).json()
    const messages = []
    for (const item of listed.messages) {
      if (!["任务已完成", "任务未成功完成"].includes(item.Subject)) continue
      const detail = await (
        await fetch(`${environment.mailpitOrigin}/api/v1/message/${item.ID}`)
      ).json()
      if (detail.Text.includes(taskId)) messages.push(detail)
    }
    return messages
  }
  async function member() {
    const recipient = await signUpVerified(
      environment.baseURL,
      origin,
      environment.migrator
    )
    const role = (
      await environment.runtime.auth.api.createOrgRole({
        headers: actor.headers,
        body: {
          organizationId,
          role: `notification-${randomUUID().slice(0, 8)}`,
          permission: { project: ["export"] },
        },
      })
    ).roleData
    const membership = await environment.runtime.auth.api.addMember({
      headers: actor.headers,
      body: { organizationId, userId: recipient.user.id, role: role.role },
    })
    return { recipient, membership }
  }
  async function removeMember(membership) {
    const headers = new Headers(actor.headers)
    const version = await environment.observer.query(
      "SELECT authorization_version FROM organization_status WHERE organization_id=$1",
      [organizationId]
    )
    headers.set(
      "X-Expected-Authz-Version",
      String(version.rows[0].authorization_version)
    )
    await environment.runtime.auth.api.removeMember({
      headers,
      body: { organizationId, memberIdOrEmail: membership.id },
    })
  }
  it("新的成员通知列表为空且未读计数为零", async () => {
    const response = await fetch(
      `${environment.baseURL}/api/v1/organizations/${organizationId}/notifications?page=1&pageSize=20`,
      { headers: actor.headers }
    )
    expect(response.status).toBe(200)
    expect(NotificationPageSchema.parse(await response.json())).toEqual({
      items: [],
      total: 0,
      unreadCount: 0,
      page: 1,
      pageSize: 20,
    })
  })
  it("成员读取默认邮件偏好并保存自己的选择，重新读取保持一致", async () => {
    const path = `${environment.baseURL}/api/v1/organizations/${organizationId}/notification-preferences`
    const initial = await fetch(path, { headers: actor.headers })
    expect(initial.status).toBe(200)
    expect(NotificationPreferencesSchema.parse(await initial.json())).toEqual({
      emailEnabled: false,
    })
    const updated = await fetch(path, {
      method: "PUT",
      headers: {
        cookie: actor.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ emailEnabled: true }),
    })
    expect(updated.status).toBe(200)
    const current = await fetch(path, { headers: actor.headers })
    expect(current.status).toBe(200)
    expect(NotificationPreferencesSchema.parse(await current.json())).toEqual({
      emailEnabled: true,
    })
  })
  it("真实Worker完成任务重复结算仅一通知、一邮件，重复已读保持同一时刻", async () => {
    const task = await exportTask()
    const id = task.id
    expect(await execute(task)).toMatchObject({
      result: { count: 0, issues: [] },
    })
    const binding = await environment.observer.query(
      "SELECT intent_fingerprint FROM business_tasks WHERE id=$1",
      [id]
    )
    // 重复结算读取真实Worker已提交的终态，不构造完成状态或修改任务输入。
    const settle = () =>
      environment.runtime.pool.query(
        "SELECT public.record_task_result_delivery($1,$2,$3,$4) AS event_id",
        [organizationId, actor.user.id, id, binding.rows[0].intent_fingerprint]
      )
    const settled = await settle()
    expect((await settle()).rows[0].event_id).toBe(settled.rows[0].event_id)
    const path = `${environment.baseURL}/api/v1/organizations/${organizationId}/notifications`
    const before = NotificationPageSchema.parse(
      await (await fetch(path, { headers: actor.headers })).json()
    )
    expect(before.unreadCount).toBe(1)
    expect(before.items).toHaveLength(1)
    const notification = before.items.find((item) => item.taskId === id)
    expect(notification).toMatchObject({
      recipientId: actor.user.id,
      type: "task.completed",
      readAt: null,
    })
    const mark = () =>
      fetch(`${path}/${notification.id}/read`, {
        method: "POST",
        headers: actor.headers,
      })
    const first = await mark()
    expect(first.status).toBe(201)
    const seen = NotificationSchema.parse(await first.json())
    expect(seen.readAt).not.toBeNull()
    const repeated = await mark()
    expect(NotificationSchema.parse(await repeated.json()).readAt).toBe(
      seen.readAt
    )
    const after = NotificationPageSchema.parse(
      await (await fetch(path, { headers: actor.headers })).json()
    )
    expect(after.unreadCount).toBe(0)
    expect(await delivery().dispatchOne()).toBe(true)
    expect(await emailFact(id)).toMatchObject({
      email_status: "sent",
      email_attempts: 1,
    })
    const messages = await taskMessages(id)
    expect(messages).toHaveLength(1)
    expect(messages[0].To.map((entry) => entry.Address)).toEqual([
      actor.user.email,
    ])
    expect(messages[0].Text).toContain(
      `/app/tasks/${organizationId}?source=business&taskId=${id}`
    )
    await settle()
    expect(await emailFact(id)).toMatchObject({
      id: notification.id,
      email_status: "sent",
      email_attempts: 1,
    })
    expect(await delivery().dispatchOne()).toBe(false)
    expect(await taskMessages(id)).toHaveLength(1)
  })
  it("计划存在后关闭本人邮件偏好，当前投递disabled且SMTP无邮件", async () => {
    const task = await exportTask()
    await execute(task)
    expect((await emailFact(task.id)).email_status).toBe("pending")
    await preferences(false)
    expect(await delivery().dispatchOne()).toBe(true)
    expect(await emailFact(task.id)).toMatchObject({
      email_status: "disabled",
      email_attempts: 1,
    })
    expect(await taskMessages(task.id)).toHaveLength(0)
    expect((await list()).items.some((item) => item.taskId === task.id)).toBe(
      true
    )
    await preferences(true)
    expect(await delivery().dispatchOne()).toBe(false)
    expect(await taskMessages(task.id)).toHaveLength(0)
  })
  it("同组织其他成员与owner均只能列出、标记本人通知", async () => {
    const { recipient } = await member()
    const task = await exportTask(recipient)
    await execute(task)
    const own = await list(recipient)
    expect(own.items).toHaveLength(1)
    expect(own.unreadCount).toBe(1)
    expect(own.items[0]).toMatchObject({
      taskId: task.id,
      recipientId: recipient.user.id,
    })
    const owners = await list()
    expect(
      owners.items.every((item) => item.recipientId === actor.user.id)
    ).toBe(true)
    expect(owners.items.some((item) => item.taskId === task.id)).toBe(false)
    for (const [viewer, notification] of [
      [actor, own.items[0]],
      [recipient, owners.items[0]],
    ]) {
      const response = await fetch(
        `${path()}/notifications/${notification.id}/read`,
        {
          method: "POST",
          headers: viewer.headers,
        }
      )
      expect(response.status).toBe(404)
    }
    expect((await list(recipient)).items[0].readAt).toBeNull()
    const mark = await fetch(
      `${path()}/notifications/${own.items[0].id}/read`,
      {
        method: "POST",
        headers: recipient.headers,
      }
    )
    expect(mark.status).toBe(201)
    expect(NotificationSchema.parse(await mark.json()).recipientId).toBe(
      recipient.user.id
    )
    expect(await delivery().dispatchOne()).toBe(true)
    expect((await emailFact(task.id)).email_status).toBe("disabled")
    expect(await taskMessages(task.id)).toHaveLength(0)
  })
  it("完成后的邮件计划在收件人被移出组织后永久拒绝，不发送SMTP", async () => {
    const { recipient, membership } = await member()
    await preferences(true, recipient)
    const task = await exportTask(recipient)
    await execute(task)
    expect((await emailFact(task.id)).email_status).toBe("pending")
    await removeMember(membership)
    expect(await delivery().dispatchOne()).toBe(true)
    expect(await emailFact(task.id)).toMatchObject({
      recipient_id: recipient.user.id,
      email_status: "disabled",
      email_attempts: 1,
    })
    expect(await taskMessages(task.id)).toHaveLength(0)
    const rejected = await fetch(`${path()}/notifications`, {
      headers: recipient.headers,
    })
    expect(rejected.status).toBe(403)
    await environment.runtime.auth.api.addMember({
      headers: actor.headers,
      body: { organizationId, userId: recipient.user.id, role: "member" },
    })
    expect(await delivery().dispatchOne()).toBe(false)
    expect(await taskMessages(task.id)).toHaveLength(0)
  })
  it("提交后移除发起人，Worker持久rejected并派生原收件人失败通知，邮件拒绝发送", async () => {
    const { recipient, membership } = await member()
    await preferences(true, recipient)
    const task = await exportTask(recipient)
    await removeMember(membership)
    expect(await execute(task, "rejected")).toMatchObject({
      errorCode: "MEMBERSHIP_REQUIRED",
      resultAvailable: false,
    })
    expect(await emailFact(task.id)).toMatchObject({
      recipient_id: recipient.user.id,
      type: "task.failed",
      email_status: "pending",
    })
    expect(await delivery().dispatchOne()).toBe(true)
    expect((await emailFact(task.id)).email_status).toBe("disabled")
    expect(await taskMessages(task.id)).toHaveLength(0)
    expect((await list()).items.some((item) => item.taskId === task.id)).toBe(
      false
    )
  })
  it("真实CSV校验失败整批零提交，SMTP失败邮件仍只有薄任务链接", async () => {
    const name = `Private project ${randomUUID()}`
    const description = `Private description ${randomUUID()}`
    const before = await environment.observer.query(
      "SELECT count(*)::integer AS count FROM projects WHERE organization_id=$1",
      [organizationId]
    )
    const csv = `name,description,contentLocale\n${name},${description},zh-CN\n,invalid,zh-CN\n`
    const task = await submit("imports", {
      format: "csv",
      contentBase64: Buffer.from(csv).toString("base64"),
    })
    expect(await execute(task, "failed")).toMatchObject({
      errorCode: "IMPORT_VALIDATION_FAILED",
      result: {
        count: 0,
        issues: [{ row: 3, field: "name", code: "INVALID_NAME" }],
      },
    })
    const after = await environment.observer.query(
      "SELECT count(*)::integer AS count FROM projects WHERE organization_id=$1",
      [organizationId]
    )
    expect(after.rows[0].count).toBe(before.rows[0].count)
    expect(await delivery().dispatchOne()).toBe(true)
    expect(await emailFact(task.id)).toMatchObject({
      type: "task.failed",
      email_status: "sent",
      email_attempts: 1,
    })
    const messages = await taskMessages(task.id)
    expect(messages).toHaveLength(1)
    const message = messages[0]
    expect(message.Subject).toBe("任务未成功完成")
    expect(message.To.map((entry) => entry.Address)).toEqual([actor.user.email])
    expect(message.Text).toContain(
      `/app/tasks/${organizationId}?source=business&taskId=${task.id}`
    )
    for (const privateValue of [
      name,
      description,
      csv,
      "INVALID_NAME",
      "IMPORT_VALIDATION_FAILED",
    ]) {
      expect(message.Text).not.toContain(privateValue)
      expect(message.HTML).not.toContain(privateValue)
    }
  })
})
