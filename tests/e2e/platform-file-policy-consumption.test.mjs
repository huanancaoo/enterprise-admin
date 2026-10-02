import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { expect as expectUI } from "playwright/test"
import { signUpVerified } from "../setup/complete-signup.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { startPersonalAvatarBrowser } from "../setup/personal-avatar-runtime.mjs"

const sha = (value) => createHash("sha256").update(value).digest("hex")
const day = 86_400_000

for (const kind of ["Local", "RustFS"])
  describe(kind + ": platform policy consumed by tenant Files UI", () => {
    const resources = new AsyncDisposableStack()
    let environment, tenantContext, platformContext, tenantPage, platformPage
    beforeAll(async () => {
      try {
        environment = await startPersonalAvatarBrowser(kind, resources)
      } catch (error) {
        await resources.disposeAsync()
        throw error
      }
    })
    afterAll(() => resources.disposeAsync())
    afterEach(async ({ task }) => {
      if (task.result?.state === "fail") {
        for (const [name, page] of [
          ["tenant", tenantPage],
          ["platform", platformPage],
        ])
          if (page && !page.isClosed()) {
            console.info(
              name + " policy consumption failure",
              page.url(),
              await page.locator("main").innerText()
            )
            await page.screenshot({
              path: `/private/tmp/platform-policy-${kind}-${name}-failure.png`,
              fullPage: true,
            })
          }
      }
      await tenantContext?.close()
      await platformContext?.close()
    })
    const writes = (fixture, suffix) => (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `/api/v1/organizations/${fixture.organization.id}/files/${suffix}`
    const queue = () =>
      tenantPage.getByRole("region", { name: "上传任务", exact: true })
    const row = (name) =>
      tenantPage
        .locator("tbody tr")
        .filter({ has: tenantPage.getByRole("button", { name, exact: true }) })
    async function selection(payload, overwrite = false) {
      const trigger = overwrite ? "覆盖文件" : "上传文件"
      await tenantPage
        .getByRole("button", { name: trigger, exact: true })
        .click()
      const dialog = tenantPage.getByRole("dialog", {
        name: trigger,
        exact: true,
      })
      await dialog
        .getByLabel("选择文件", { exact: true })
        .setInputFiles(payload)
      return {
        dialog,
        start: () =>
          dialog
            .getByRole("button", {
              name: overwrite ? "确认覆盖" : "开始上传",
              exact: true,
            })
            .click(),
      }
    }
    async function upload(fixture, name, buffer, previous) {
      if (previous) await row(name).getByRole("checkbox").check()
      const form = await selection(
        { name, mimeType: "text/plain", buffer },
        Boolean(previous)
      )
      const submitted = tenantPage.waitForResponse(
        writes(
          fixture,
          previous ? `entries/${previous.entryId}/overwrite` : "uploads"
        )
      )
      await form.start()
      const response = await submitted
      expect(response.status(), await response.text()).toBe(200)
      const receipt = await response.json()
      expect(receipt.phase).toBe("completed")
      await expectUI(form.dialog).toHaveCount(0)
      await expectUI(queue().getByRole("status").last()).toHaveText("上传完成")
      if (previous) await row(name).getByRole("checkbox").uncheck()
      return receipt
    }
    async function trash(fixture, name, file) {
      await row(name).getByRole("checkbox").check()
      await tenantPage
        .getByRole("button", { name: "移入回收站", exact: true })
        .click()
      const dialog = tenantPage.getByRole("dialog", {
        name: "移入回收站",
        exact: true,
      })
      const submitted = tenantPage.waitForResponse(
        writes(fixture, `entries/${file.entryId}/trash`)
      )
      await dialog
        .getByRole("button", { name: "移入回收站", exact: true })
        .click()
      const response = await submitted
      expect(response.status(), await response.text()).toBe(200)
      expect((await response.json()).phase).toBe("completed")
      await expectUI(dialog).toHaveCount(0)
      await expectUI(row(name)).toHaveCount(0)
    }
    async function facts(fixture) {
      const results = await Promise.all([
        environment.observer.query(
          "SELECT * FROM file_storage_usage WHERE organization_id=$1",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT * FROM file_versions WHERE organization_id=$1 ORDER BY id",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT * FROM file_entries WHERE organization_id=$1 ORDER BY id",
          [fixture.organization.id]
        ),
        environment.observer.query(
          "SELECT * FROM file_operations WHERE organization_id=$1 ORDER BY created_at,id",
          [fixture.organization.id]
        ),
      ])
      return {
        usage: results[0].rows[0],
        versions: results[1].rows,
        entries: results[2].rows,
        operations: results[3].rows,
      }
    }
    async function content(fixture, file, body) {
      const response = await fetch(
        environment.baseURL +
          `/api/v1/organizations/${fixture.organization.id}/files/entries/${file.entryId}/versions/${file.versionId}/content`,
        { headers: Object.fromEntries(fixture.owner.headers) }
      )
      expect(response.status).toBe(200)
      expect(Buffer.from(await response.arrayBuffer())).toEqual(body)
    }
    async function policy(
      fixture,
      quota,
      trashDays,
      historyDays,
      expectedVersion
    ) {
      await platformPage
        .getByLabel("存储配额（GiB）", { exact: true })
        .fill(String(quota))
      await platformPage
        .getByLabel("回收站保留天数", { exact: true })
        .fill(String(trashDays))
      await platformPage
        .getByLabel("历史版本保留天数", { exact: true })
        .fill(String(historyDays))
      await platformPage
        .getByLabel("修改理由", { exact: true })
        .fill("实际两后台政策消费与保留期限验收")
      const submitted = platformPage.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname ===
            `/api/v1/platform/organizations/${fixture.organization.id}/storage-policy`
      )
      await platformPage
        .getByRole("button", { name: "保存", exact: true })
        .click()
      const response = await submitted
      expect(response.status(), await response.text()).toBe(200)
      expect(response.request().postDataJSON()).toMatchObject({
        quotaBytes: quota * 2 ** 30,
        trashDays,
        historyDays,
        expectedVersion,
      })
      expect(response.request().headers()["idempotency-key"]).toMatch(
        /^[0-9a-f-]{36}$/
      )
      const result = await response.json()
      expect(result).toMatchObject({
        quotaBytes: quota * 2 ** 30,
        trashDays,
        historyDays,
        version: expectedVersion + 1,
      })
      await expectUI(
        platformPage.getByText("存储策略已保存。", { exact: true })
      ).toBeVisible()
      await expectUI(
        platformPage.getByLabel("修改理由", { exact: true })
      ).toHaveValue("")
      return result
    }

    it("正式平台UI调额→租户保留原File后新UUID重试成功，新回收和未引用历史采用新期限而既有期限不改", async () => {
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator,
        { name: "政策消费租户用户" }
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "政策消费组织", slug: randomUUID() },
        })
      const fixture = { owner, organization }
      const admin = await platformOperator(
        environment,
        environment.platformOrigin
      )
      tenantContext = await environment.browser.newContext({
        viewport: { width: 1360, height: 1000 },
      })
      platformContext = await environment.browser.newContext({
        viewport: { width: 1360, height: 1100 },
      })
      await platformContext.addCookies(
        admin.cookie.split("; ").map((part) => {
          const offset = part.indexOf("=")
          return {
            name: part.slice(0, offset),
            value: part.slice(offset + 1),
            url: environment.platformOrigin,
            httpOnly: true,
            sameSite: "Lax",
          }
        })
      )
      tenantPage = await tenantContext.newPage()
      platformPage = await platformContext.newPage()
      await tenantPage.goto(environment.tenantOrigin + "/app/")
      await tenantPage.getByLabel("邮箱", { exact: true }).fill(owner.email)
      await tenantPage.getByLabel("密码", { exact: true }).fill(owner.password)
      await tenantPage
        .getByRole("button", { name: "登录", exact: true })
        .click()
      await tenantPage.getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(
        tenantPage.getByRole("button", { name: "上传文件", exact: true })
      ).toBeVisible()

      // 既有期限由原策略经正式租户 UI 产生；observer 只读事实，政策变化必须来自平台 UI 保存。
      const originalBody = Buffer.from("变更前固定旧版本\n")
      const middleBody = Buffer.from("变更前覆盖的当前版本\n")
      const latestBody = Buffer.from("变更后覆盖的当前版本\n")
      const trashBody = Buffer.from("政策变更前回收的原字节\n")
      const selectedBody = Buffer.from([0, 255, 128, 13, 10, 7])
      const original = await upload(fixture, "历史政策.txt", originalBody)
      const middle = await upload(
        fixture,
        "历史政策.txt",
        middleBody,
        original.result
      )
      const oldTrash = await upload(fixture, "原回收期限.txt", trashBody)
      await trash(fixture, "原回收期限.txt", oldTrash.result)
      const before = await facts(fixture)
      const oldHistory = before.versions.find(
        (version) => version.id === original.result.versionId
      )
      const oldTrashEntry = before.entries.find(
        (entry) => entry.id === oldTrash.result.entryId
      )
      expect(
        oldHistory.expires_at.getTime() - oldHistory.retired_at.getTime()
      ).toBe(90 * day)
      expect(
        oldTrashEntry.expires_at.getTime() - oldTrashEntry.deleted_at.getTime()
      ).toBe(30 * day)
      expect(
        before.versions.every((version) => version.purged_at === null)
      ).toBe(true)

      await platformPage.goto(
        environment.platformOrigin +
          `/platform/organizations/${organization.id}`
      )
      await expectUI(
        platformPage.getByLabel("存储配额（GiB）", { exact: true })
      ).toHaveValue("10")
      const lower = await policy(fixture, 0, 7, 30, 1)
      expect(lower.overQuota).toBe(true)
      await expectUI(
        platformPage.getByText(
          "本组织已超过配额。现有文件仍可访问，增加存储占用的上传已被阻止。",
          { exact: true }
        )
      ).toBeVisible()
      const form = await selection({
        name: "保留原File.bin",
        mimeType: "application/octet-stream",
        buffer: selectedBody,
      })
      const rejected = tenantPage.waitForResponse(writes(fixture, "uploads"))
      await form.start()
      const rejection = await rejected
      expect(rejection.status()).toBe(409)
      expect((await rejection.json()).code).toBe("FILE_QUOTA_EXCEEDED")
      const job = queue().getByRole("listitem", {
        name: "保留原File.bin",
        exact: true,
      })
      await expectUI(job.getByRole("status")).toHaveText("上传未完成")
      await expectUI(job.getByRole("alert")).toHaveText(
        "组织可用存储空间不足，请联系管理员。"
      )
      const failed = await facts(fixture)
      const rejectedOperation = failed.operations.find(
        (operation) => operation.error_code === "FILE_QUOTA_EXCEEDED"
      )
      expect(rejectedOperation).toMatchObject({
        phase: "failed",
        committed_at: null,
        completed_at: null,
      })
      expect(failed.versions).toEqual(before.versions)
      expect(failed.entries).toEqual(before.entries)
      expect(failed.usage.used_bytes).toBe(before.usage.used_bytes)
      expect(Number(failed.usage.reserved_bytes)).toBe(0)
      expect(Number(failed.usage.transient_bytes)).toBe(0)
      await expectUI(row("保留原File.bin")).toHaveCount(0)
      await content(fixture, original.result, originalBody)
      await content(fixture, middle.result, middleBody)

      await policy(fixture, 1, 7, 30, 2)
      await job.getByRole("button", { name: "重新上传", exact: true }).click()
      const retry = tenantPage.getByRole("dialog", {
        name: "上传文件",
        exact: true,
      })
      await expectUI(
        retry.getByRole("textbox", { name: "上传后的文件名", exact: true })
      ).toHaveValue("保留原File.bin")
      await expectUI(
        retry.getByText("保留原File.bin", { exact: true })
      ).toBeVisible()
      const accepted = tenantPage.waitForResponse(writes(fixture, "uploads"))
      await retry.getByRole("button", { name: "开始上传", exact: true }).click()
      const response = await accepted
      expect(response.status(), await response.text()).toBe(200)
      const completed = await response.json()
      expect(completed.id).not.toBe(rejectedOperation.id)
      expect(completed.phase).toBe("completed")
      const afterUpload = await facts(fixture)
      expect(
        afterUpload.versions.find(
          (version) => version.id === completed.result.versionId
        )
      ).toMatchObject({
        bytes: String(selectedBody.length),
        sha256: sha(selectedBody),
      })
      expect(Number(afterUpload.usage.used_bytes)).toBe(
        Number(before.usage.used_bytes) + selectedBody.length
      )
      expect(Number(afterUpload.usage.reserved_bytes)).toBe(0)
      expect(Number(afterUpload.usage.transient_bytes)).toBe(0)
      const acceptedJob = queue()
        .getByRole("listitem", { name: "保留原File.bin", exact: true })
        .filter({
          has: tenantPage
            .getByRole("status", { name: "", exact: true })
            .filter({ hasText: "上传完成" }),
        })
      await acceptedJob
        .getByRole("button", { name: "查看所上传版本", exact: true })
        .click()
      const downloaded = tenantPage.waitForEvent("download")
      await tenantPage
        .getByRole("button", { name: "下载文件", exact: true })
        .click()
      const download = await downloaded
      expect(download.suggestedFilename()).toBe("保留原File.bin")
      expect(await download.failure()).toBeNull()
      expect(await readFile(await download.path())).toEqual(selectedBody)
      await tenantPage.getByRole("link", { name: "文件", exact: true }).click()
      await expectUI(row("历史政策.txt")).toBeVisible()
      await upload(fixture, "历史政策.txt", latestBody, middle.result)
      await trash(fixture, "保留原File.bin", completed.result)
      const final = await facts(fixture)
      const newHistory = final.versions.find(
        (version) => version.id === middle.result.versionId
      )
      const newTrash = final.entries.find(
        (entry) => entry.id === completed.result.entryId
      )
      expect(
        newHistory.expires_at.getTime() - newHistory.retired_at.getTime()
      ).toBe(30 * day)
      expect(
        newTrash.expires_at.getTime() - newTrash.deleted_at.getTime()
      ).toBe(7 * day)
      expect(
        final.versions.find((version) => version.id === oldHistory.id)
      ).toEqual(oldHistory)
      expect(
        final.entries.find((entry) => entry.id === oldTrashEntry.id)
      ).toEqual(oldTrashEntry)
      expect(
        final.versions.every((version) => version.purged_at === null)
      ).toBe(true)
      expect(final.usage).toMatchObject({
        quota_bytes: String(2 ** 30),
        history_days: 30,
        trash_days: 7,
        policy_revision: 3,
        reserved_bytes: "0",
        transient_bytes: "0",
      })
      expect(Number(final.usage.used_bytes)).toBe(
        Number(before.usage.used_bytes) +
          selectedBody.length +
          latestBody.length
      )
      expect(
        final.operations.find(
          (operation) => operation.id === rejectedOperation.id
        )
      ).toEqual(rejectedOperation)
      await content(fixture, original.result, originalBody)
      await content(fixture, middle.result, middleBody)
      expect(
        final.operations.filter(
          (operation) =>
            operation.action === "upload" &&
            operation.result?.entryId === completed.result.entryId
        )
      ).toHaveLength(1)
      await platformPage.reload()
      await expectUI(
        platformPage.getByLabel("存储配额（GiB）", { exact: true })
      ).toHaveValue("1")
      await expectUI(
        platformPage.getByLabel("回收站保留天数", { exact: true })
      ).toHaveValue("7")
      await expectUI(
        platformPage.getByLabel("历史版本保留天数", { exact: true })
      ).toHaveValue("30")
    }, 120_000)
  })
