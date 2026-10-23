import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { expect as expectUI } from "playwright/test"
import { startPersonalAvatarBrowser } from "../setup/personal-avatar-runtime.mjs"
import { platformOperator } from "../setup/platform-operator.mjs"
import { signUpVerified } from "../setup/complete-signup.mjs"

const require = createRequire(resolve("apps/api/package.json"))
const sharp = require("sharp")

for (const kind of ["Local", "RustFS"])
  describe(`平台文件与公告浏览器 - ${kind}`, () => {
    const resources = new AsyncDisposableStack()
    let environment
    beforeAll(async () => {
      environment = await startPersonalAvatarBrowser(kind, resources)
    })
    afterAll(() => resources.disposeAsync())
    test("目录上传与覆盖→公告选择历史版本→指定受众下载→引用保护、回收恢复、策略和三语", async () => {
      const admin = await platformOperator(
        environment,
        environment.platformOrigin
      )
      const owner = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator
      )
      const other = await signUpVerified(
        environment.baseURL,
        environment.tenantOrigin,
        environment.migrator
      )
      const organization =
        await environment.runtime.auth.api.createOrganization({
          headers: owner.headers,
          body: { name: "文件公告接收组织", slug: randomUUID() },
        })
      const excluded = await environment.runtime.auth.api.createOrganization({
        headers: other.headers,
        body: { name: "文件公告非接收组织", slug: randomUUID() },
      })
      async function pageFor(account, origin) {
        const context = await environment.browser.newContext({
          viewport: { width: 1440, height: 1100 },
        })
        resources.defer(() => context.close())
        await context.addCookies(
          account.cookie.split("; ").map((part) => {
            const index = part.indexOf("=")
            return {
              name: part.slice(0, index),
              value: part.slice(index + 1),
              url: origin,
              httpOnly: true,
              sameSite: "Lax",
            }
          })
        )
        return context.newPage()
      }
      const page = await pageFor(admin, environment.platformOrigin)
      const tenant = await pageFor(owner, environment.tenantOrigin)
      const denied = await pageFor(other, environment.tenantOrigin)
      page.on("pageerror", (error) =>
        console.error("platform browser error", error.message)
      )
      const responseFor = (path, method = "POST") =>
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === path &&
            response.request().method() === method
        )
      const row = (name) =>
        page
          .locator("tbody tr")
          .filter({ has: page.getByRole("button", { name, exact: true }) })
      try {
        await page.goto(environment.platformOrigin + "/platform/files")
        await page
          .getByRole("button", { name: "创建文件夹", exact: true })
          .click()
        let dialog = page.getByRole("dialog", {
          name: "创建文件夹",
          exact: true,
        })
        await dialog.getByLabel("文件夹名称", { exact: true }).fill("公告验收")
        let pending = responseFor("/api/v1/platform/files/folders")
        await dialog
          .getByRole("button", { name: "创建文件夹", exact: true })
          .click()
        const folder = (await (await pending).json()).result.entryId
        await row("公告验收")
          .getByRole("button", { name: "公告验收", exact: true })
          .click()
        await expectUI(page).toHaveURL(new RegExp(folder))
        async function upload(body, overwrite = false) {
          if (overwrite) await row("公告说明.txt").getByRole("checkbox").check()
          const title = overwrite ? "覆盖文件" : "上传文件"
          await page.getByRole("button", { name: title, exact: true }).click()
          const dialog = page.getByRole("dialog", { name: title, exact: true })
          await dialog.getByLabel("选择文件", { exact: true }).setInputFiles({
            name: "公告说明.txt",
            mimeType: "text/plain",
            buffer: Buffer.from(body),
          })
          const result = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              /\/platform\/files\/(uploads|entries\/[^/]+\/versions)$/.test(
                new URL(response.url()).pathname
              )
          )
          await dialog
            .getByRole("button", {
              name: overwrite ? "确认覆盖" : "开始上传",
              exact: true,
            })
            .click()
          const response = await result
          expect(response.status(), await response.text()).toBe(200)
          await expectUI(dialog).toHaveCount(0)
          await expectUI(row("公告说明.txt")).toBeVisible()
          if (overwrite)
            await row("公告说明.txt").getByRole("checkbox").uncheck()
          return (await response.json()).result
        }
        const first = await upload("公告历史版本字节\n")
        const second = await upload("文件库当前版本字节\n", true)
        await row("公告说明.txt")
          .getByRole("button", { name: "公告说明.txt", exact: true })
          .click()
        await expectUI(
          page.getByText("文件库当前版本字节", { exact: false })
        ).toBeVisible()
        let downloaded = page.waitForEvent("download")
        await page
          .getByRole("button", { name: "下载文件", exact: true })
          .click()
        expect(await readFile(await (await downloaded).path(), "utf8")).toBe(
          "文件库当前版本字节\n"
        )

        await page.goto(
          environment.platformOrigin + "/platform/announcements/new"
        )
        await page
          .getByLabel("标题", { exact: true })
          .fill("平台文件固定版本公告")
        await page
          .getByRole("textbox", { name: "正文", exact: true })
          .fill("浏览器验收正文")
        await page
          .getByRole("button", { name: "从平台文件库选择附件", exact: true })
          .click()
        dialog = page.getByRole("dialog", { name: "选择文件", exact: true })
        await dialog
          .getByRole("button", { name: "公告验收", exact: true })
          .click()
        await dialog
          .getByRole("button", { name: "公告说明.txt", exact: true })
          .click()
        await dialog
          .getByRole("combobox", { name: "版本记录", exact: true })
          .click()
        await page.getByRole("option", { name: /历史版本/ }).click()
        await dialog
          .getByRole("button", { name: "选择文件", exact: true })
          .click()
        pending = responseFor("/api/v1/platform/announcements")
        await page
          .getByRole("button", { name: "保存草稿", exact: true })
          .click()
        const savedResponse = await pending
        expect(savedResponse.status(), await savedResponse.text()).toBe(201)
        const announcement = await savedResponse.json()
        expect(announcement.attachments[0]).toMatchObject({
          fileId: first.entryId,
          versionId: first.versionId,
        })
        await page.goto(environment.platformOrigin + "/platform/announcements")
        await row("平台文件固定版本公告")
          .getByRole("button", { name: "发布", exact: true })
          .click()
        dialog = page.getByRole("dialog", { name: "确认发布公告", exact: true })
        await dialog
          .getByRole("combobox", { name: "发布范围", exact: true })
          .click()
        await page
          .getByRole("option", { name: "指定组织", exact: true })
          .click()
        await dialog.locator('[data-slot="combobox-trigger"]').click()
        await page.getByRole("option", { name: /文件公告接收组织/ }).click()
        pending = responseFor(
          `/api/v1/platform/announcements/${announcement.id}/publish`
        )
        await dialog.getByRole("button", { name: "确认", exact: true }).click()
        const published = await pending
        expect(published.status(), await published.text()).toBe(201)

        await tenant.goto(
          environment.tenantOrigin +
            `/app/announcements/${organization.id}/${announcement.id}`
        )
        await expectUI(
          tenant.getByRole("heading", {
            name: "平台文件固定版本公告",
            exact: true,
          })
        ).toBeVisible()
        downloaded = tenant.waitForEvent("download")
        await tenant.getByRole("button", { name: /下载附件/ }).click()
        expect(await readFile(await (await downloaded).path(), "utf8")).toBe(
          "公告历史版本字节\n"
        )
        await denied.goto(
          environment.tenantOrigin +
            `/app/announcements/${excluded.id}/${announcement.id}`
        )
        await expectUI(
          denied.getByRole("heading", {
            name: "平台文件固定版本公告",
            exact: true,
          })
        ).toHaveCount(0)
        await expectUI(
          denied.getByText(/公告已撤回或你当前无权读取|资源不存在/)
        ).toBeVisible()
        const deniedMedia = await fetch(
          environment.baseURL +
            `/api/v1/organizations/${excluded.id}/announcements/media/${first.entryId}?versionId=${first.versionId}`,
          { headers: other.headers }
        )
        expect(deniedMedia.status).toBe(404)
        const unreferencedVersion = await fetch(
          environment.baseURL +
            `/api/v1/organizations/${organization.id}/announcements/media/${first.entryId}?versionId=${second.versionId}`,
          { headers: owner.headers }
        )
        expect(unreferencedVersion.status).toBe(404)

        await page.goto(
          environment.platformOrigin + `/platform/files?parentId=${folder}`
        )
        await row("公告说明.txt").getByRole("checkbox").check()
        await page
          .getByRole("button", { name: "移入回收站", exact: true })
          .click()
        dialog = page.getByRole("dialog", { name: "移入回收站", exact: true })
        await expectUI(
          dialog.getByRole("alert").filter({ hasText: "请先在业务中解除引用" })
        ).toBeVisible()
        await expectUI(
          dialog.getByRole("button", { name: "移入回收站", exact: true })
        ).toBeDisabled()
        await dialog.getByRole("button", { name: "取消", exact: true }).click()
        // 撤回立即撤销受众访问；解除引用后同一文件才允许进入回收站。
        await page.goto(environment.platformOrigin + "/platform/announcements")
        await row("平台文件固定版本公告")
          .getByRole("button", { name: "撤回", exact: true })
          .click()
        dialog = page.getByRole("dialog", { name: "确认撤回公告", exact: true })
        pending = responseFor(
          `/api/v1/platform/announcements/${announcement.id}/withdraw`
        )
        await dialog.getByRole("button", { name: "确认", exact: true }).click()
        expect((await pending).status()).toBe(201)
        const withdrawnMedia = await fetch(
          environment.baseURL +
            `/api/v1/organizations/${organization.id}/announcements/media/${first.entryId}?versionId=${first.versionId}`,
          { headers: owner.headers }
        )
        expect(withdrawnMedia.status).toBe(404)
        await row("平台文件固定版本公告")
          .getByRole("button", { name: "编辑公告", exact: true })
          .click()
        await page
          .getByRole("button", { name: "移除附件: 公告说明.txt", exact: true })
          .click()
        pending = responseFor(
          `/api/v1/platform/announcements/${announcement.id}`,
          "PUT"
        )
        await page
          .getByRole("button", { name: "保存草稿", exact: true })
          .click()
        expect((await pending).status()).toBe(200)
        await page.goto(
          environment.platformOrigin + `/platform/files?parentId=${folder}`
        )
        await row("公告说明.txt").getByRole("checkbox").check()
        await page
          .getByRole("button", { name: "移入回收站", exact: true })
          .click()
        dialog = page.getByRole("dialog", { name: "移入回收站", exact: true })
        pending = responseFor(
          `/api/v1/platform/files/entries/${first.entryId}/trash`
        )
        await dialog
          .getByRole("button", { name: "移入回收站", exact: true })
          .click()
        expect((await pending).status()).toBe(200)
        await expectUI(dialog).toHaveCount(0)
        await expectUI(row("公告说明.txt")).toHaveCount(0)
        await page.getByRole("button", { name: "回收站", exact: true }).click()
        await row("公告说明.txt").getByRole("checkbox").check()
        await page.getByRole("button", { name: "恢复", exact: true }).click()
        dialog = page.getByRole("dialog", { name: "恢复", exact: true })
        pending = responseFor(
          `/api/v1/platform/files/entries/${first.entryId}/restore`
        )
        await dialog.getByRole("button", { name: "恢复", exact: true }).click()
        expect((await pending).status()).toBe(200)
        await expectUI(dialog).toHaveCount(0)
        await page.goto(
          environment.platformOrigin + `/platform/files?parentId=${folder}`
        )
        await expectUI(row("公告说明.txt")).toBeVisible()
        await page.goto(environment.platformOrigin + "/platform/settings")
        const policy = page
          .locator("section")
          .filter({
            has: page.getByRole("heading", {
              name: "平台文件存储策略",
              exact: true,
            }),
          })
          .last()
        await policy.getByLabel("回收站保留期限", { exact: true }).fill("45")
        pending = responseFor("/api/v1/platform/files/policy")
        await policy.getByRole("button", { name: "保存", exact: true }).click()
        expect((await pending).status()).toBe(200)
        await expectUI(policy.getByRole("status")).toHaveText(
          "平台文件存储策略已保存"
        )
        await page.reload()
        await expectUI(
          policy.getByLabel("回收站保留期限", { exact: true })
        ).toHaveValue("45")
        await page.goto(environment.platformOrigin + "/platform/files")
        for (const [
          choice,
          label,
          dir,
          title,
          announcementTitle,
          chooseAttachment,
          pickTitle,
          contentSection,
        ] of [
          [
            "English",
            "语言",
            "ltr",
            "Files",
            "New announcement",
            "Choose attachment from platform files",
            "Choose a file",
            "Content management",
          ],
          [
            "العربية",
            "Language",
            "rtl",
            "الملفات",
            "إعلان جديد",
            "اختيار مرفق من ملفات المنصة",
            "اختيار ملف",
            "إدارة المحتوى",
          ],
          [
            "简体中文",
            "اللغة",
            "ltr",
            "文件",
            "新建公告",
            "从平台文件库选择附件",
            "选择文件",
            "内容管理",
          ],
        ]) {
          await page.getByRole("button", { name: /Platform operator/ }).click()
          const language = page.getByRole("menuitem", {
            name: label,
            exact: true,
          })
          await language.focus()
          await language.press(
            (await page.locator("html").getAttribute("dir")) === "rtl"
              ? "ArrowLeft"
              : "ArrowRight"
          )
          await page
            .getByRole("menuitemradio", { name: choice, exact: true })
            .click()
          await expectUI(page.locator("html")).toHaveAttribute("dir", dir)
          await expectUI(
            page.getByRole("heading", { name: title, exact: true })
          ).toBeVisible()
          await expectUI(
            page.getByRole("menu", { includeHidden: true })
          ).toHaveCount(0)
          await page.screenshot({
            path: `/tmp/platform-files-${kind}-${dir === "rtl" ? "ar" : choice === "English" ? "en" : "zh"}.png`,
            fullPage: true,
          })
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          ).toBe(true)
          // 语言菜单切换当前应用语言；沿正式菜单导航，保留当前会话的选择。
          const content = page.getByRole("button", {
            name: contentSection,
            exact: true,
          })
          if ((await content.getAttribute("aria-expanded")) === "false")
            await content.click()
          await page.locator('a[href^="/platform/announcements"]').click()
          await page
            .getByRole("button", { name: announcementTitle, exact: true })
            .click()
          await expectUI(
            page.getByRole("heading", { name: announcementTitle, exact: true })
          ).toBeVisible()
          const choose = page.getByRole("button", {
            name: chooseAttachment,
            exact: true,
          })
          await choose.click()
          const localizedPicker = page.getByRole("dialog", {
            name: pickTitle,
            exact: true,
          })
          await expectUI(localizedPicker).toBeVisible()
          await localizedPicker
            .getByRole("button", { name: "公告验收", exact: true })
            .click()
          await localizedPicker
            .getByRole("button", { name: "公告说明.txt", exact: true })
            .click()
          await expectUI(
            localizedPicker.getByRole("button", {
              name: pickTitle,
              exact: true,
            })
          ).toBeEnabled()
          await page.screenshot({
            path: `/tmp/platform-announcement-picker-${kind}-${dir === "rtl" ? "ar" : choice === "English" ? "en" : "zh"}.png`,
            fullPage: true,
          })
          const bounds = await localizedPicker.boundingBox()
          expect(bounds.x).toBeGreaterThanOrEqual(0)
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440)
          await localizedPicker.press("Escape")
          await expectUI(localizedPicker).toHaveCount(0)
          await expectUI(choose).toBeFocused()
          await page.getByRole("link", { name: title, exact: true }).click()
        }
        expect(first.versionId).not.toBe(second.versionId)
      } catch (error) {
        console.info(
          "platform files browser failure",
          page.url(),
          await page.locator("body").innerText()
        )
        await page.screenshot({
          path: `/tmp/platform-files-${kind}-failure.png`,
          fullPage: true,
        })
        throw error
      }
    }, 120_000)
    test("公告正文从文件库选择历史图片，发布后仍读取固定图片版本", async () => {
      const admin = await platformOperator(
        environment,
        environment.platformOrigin
      )
      const base = environment.baseURL + "/api/v1/platform"
      const fileName = `历史图片-${randomUUID()}.png`
      const oldImage = await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { r: 20, g: 100, b: 220, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
      const newImage = await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { r: 220, g: 40, b: 20, alpha: 1 },
        },
      })
        .png()
        .toBuffer()
      const upload = async (bytes, previous) => {
        const form = new FormData()
        const fields = {
          operationId: randomUUID(),
          declaredBytes: bytes.length,
          contentSha256: createHash("sha256").update(bytes).digest("hex"),
          ...(previous
            ? { expectedRevision: previous.revision }
            : {
                parentId: "00000000-0000-4000-8000-000000000002",
                name: fileName,
              }),
        }
        for (const [key, value] of Object.entries(fields))
          form.append(key, String(value))
        form.append("file", new File([bytes], fileName, { type: "image/png" }))
        const result = await fetch(
          base +
            (previous
              ? `/files/entries/${previous.entryId}/versions`
              : "/files/uploads"),
          { method: "POST", headers: admin.headers, body: form }
        )
        expect(result.status, await result.clone().text()).toBe(200)
        return (await result.json()).result
      }
      const first = await upload(oldImage)
      await upload(newImage, first)
      const context = await environment.browser.newContext({
        viewport: { width: 1440, height: 1100 },
      })
      resources.defer(() => context.close())
      await context.addCookies(
        admin.cookie.split("; ").map((part) => {
          const separator = part.indexOf("=")
          return {
            name: part.slice(0, separator),
            value: part.slice(separator + 1),
            url: environment.platformOrigin,
            httpOnly: true,
            sameSite: "Lax",
          }
        })
      )
      const page = await context.newPage()
      await page.goto(
        environment.platformOrigin + "/platform/announcements/new"
      )
      await page.getByLabel("标题", { exact: true }).fill("历史图片公告")
      await page
        .getByRole("textbox", { name: "正文", exact: true })
        .fill("正文历史图片")
      await page
        .getByRole("button", { name: "从文件库插入图片", exact: true })
        .click()
      const picker = page.getByRole("dialog", { name: "选择文件", exact: true })
      await picker.getByRole("button", { name: fileName, exact: true }).click()
      await picker
        .getByRole("combobox", { name: "版本记录", exact: true })
        .click()
      await page.getByRole("option", { name: /历史版本/ }).click()
      await picker
        .getByRole("button", { name: "选择文件", exact: true })
        .click()
      await expectUI(
        page.locator('[data-slot="rich-text-editor"] img')
      ).toBeVisible()
      await expectUI(
        page.getByRole("textbox", { name: "正文", exact: true })
      ).toHaveAttribute("contenteditable", "true")
      const saved = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/v1/platform/announcements" &&
          response.request().method() === "POST"
      )
      await page.getByRole("button", { name: "保存草稿", exact: true }).click()
      const response = await saved
      expect(response.status(), await response.text()).toBe(201)
      const announcement = await response.json()
      expect(JSON.stringify(announcement.content)).toContain(first.versionId)
      const published = await fetch(
        base + `/announcements/${announcement.id}/publish`,
        {
          method: "POST",
          headers: {
            ...Object.fromEntries(admin.headers),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedVersion: announcement.version,
            audience: "platform",
            organizationIds: [],
          }),
        }
      )
      expect(published.status, await published.clone().text()).toBe(201)
      const media = await fetch(
        base +
          `/announcement-inbox/media/${first.entryId}?versionId=${first.versionId}`,
        { headers: admin.headers }
      )
      expect(media.status).toBe(200)
      expect(Buffer.from(await media.arrayBuffer())).toEqual(oldImage)
    }, 60_000)
  })
